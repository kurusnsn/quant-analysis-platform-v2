using System.Collections.Concurrent;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using OpenTelemetry.Trace;

namespace QuantPlatform.Gateway.Observability;

public sealed class DbPoolWaitInterceptor : DbConnectionInterceptor
{
    private sealed record ConnectionTiming(Activity? Activity, long StartTimestamp);

    private readonly ConcurrentDictionary<DbConnection, ConnectionTiming> _timings = new();

    public override InterceptionResult ConnectionOpening(
        DbConnection connection,
        ConnectionEventData eventData,
        InterceptionResult result)
    {
        StartTiming(connection);
        return result;
    }

    public override ValueTask<InterceptionResult> ConnectionOpeningAsync(
        DbConnection connection,
        ConnectionEventData eventData,
        InterceptionResult result,
        CancellationToken cancellationToken = default)
    {
        StartTiming(connection);
        return ValueTask.FromResult(result);
    }

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        StopTiming(connection, null);
        GatewayTelemetry.IncrementDbConnections();
    }

    public override Task ConnectionOpenedAsync(
        DbConnection connection,
        ConnectionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        StopTiming(connection, null);
        GatewayTelemetry.IncrementDbConnections();
        return Task.CompletedTask;
    }

    public override void ConnectionClosed(DbConnection connection, ConnectionEndEventData eventData)
    {
        GatewayTelemetry.DecrementDbConnections();
    }

    public override Task ConnectionClosedAsync(
        DbConnection connection,
        ConnectionEndEventData eventData)
    {
        GatewayTelemetry.DecrementDbConnections();
        return Task.CompletedTask;
    }

    public override void ConnectionFailed(DbConnection connection, ConnectionErrorEventData eventData)
    {
        StopTiming(connection, eventData.Exception);
    }

    public override Task ConnectionFailedAsync(
        DbConnection connection,
        ConnectionErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        StopTiming(connection, eventData.Exception);
        return Task.CompletedTask;
    }

    private void StartTiming(DbConnection connection)
    {
        var activity = GatewayTelemetry.ActivitySource.StartActivity("db.pool.wait", ActivityKind.Internal);
        var start = Stopwatch.GetTimestamp();
        _timings[connection] = new ConnectionTiming(activity, start);
    }

    private void StopTiming(DbConnection connection, Exception? exception)
    {
        if (!_timings.TryRemove(connection, out var timing))
        {
            return;
        }

        var durationMs = (Stopwatch.GetTimestamp() - timing.StartTimestamp) * 1000.0 / Stopwatch.Frequency;
        var tags = new TagList
        {
            { "db.system", "postgresql" }
        };

        GatewayTelemetry.DbPoolWaitDuration.Record(durationMs, tags);

        if (timing.Activity != null)
        {
            timing.Activity.SetTag("db.system", "postgresql");
            timing.Activity.SetTag("db.pool.wait.ms", durationMs);
            if (exception != null)
            {
                timing.Activity.RecordException(exception);
                timing.Activity.SetTag("error", true);
            }
            timing.Activity.Stop();
        }
    }
}
