using System.Diagnostics;
using System.Diagnostics.Metrics;
using Hangfire.Server;

namespace QuantPlatform.Gateway.Observability;

public sealed class QueueWaitFilter : IServerFilter
{
    public void OnPerforming(PerformingContext filterContext)
    {
        var createdAt = filterContext.BackgroundJob?.CreatedAt;
        if (!createdAt.HasValue)
        {
            return;
        }

        var createdUtc = createdAt.Value.Kind == DateTimeKind.Utc
            ? createdAt.Value
            : createdAt.Value.ToUniversalTime();
        var nowUtc = DateTime.UtcNow;
        var waitMs = (nowUtc - createdUtc).TotalMilliseconds;

        var jobType = filterContext.BackgroundJob?.Job?.Type?.Name ?? "unknown";
        var jobMethod = filterContext.BackgroundJob?.Job?.Method?.Name ?? "unknown";

        var tags = new TagList
        {
            { "job.type", jobType },
            { "job.method", jobMethod }
        };

        GatewayTelemetry.QueueWaitDuration.Record(waitMs, tags);
        GatewayTelemetry.BackgroundJobCount.Add(1, tags);

        using var activity = GatewayTelemetry.ActivitySource.StartActivity(
            "background.queue.wait",
            ActivityKind.Internal,
            default(ActivityContext),
            tags,
            startTime: new DateTimeOffset(createdUtc));

        activity?.Stop();
    }

    public void OnPerformed(PerformedContext filterContext)
    {
    }
}
