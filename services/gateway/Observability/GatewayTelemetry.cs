using System.Collections.Generic;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Threading;

namespace QuantPlatform.Gateway.Observability;

public static class GatewayTelemetry
{
    public const string ActivitySourceName = "QuantPlatform.Gateway";
    public const string MeterName = "QuantPlatform.Gateway";

    public static readonly ActivitySource ActivitySource = new(ActivitySourceName);
    public static readonly Meter Meter = new(MeterName);

    public static readonly Histogram<double> RequestDuration = Meter.CreateHistogram<double>(
        "quant-platform.request.duration.ms",
        unit: "ms");

    public static readonly Counter<long> RequestCount = Meter.CreateCounter<long>(
        "quant-platform.request.count");

    public static readonly Counter<long> ErrorCount = Meter.CreateCounter<long>(
        "quant-platform.error.count");

    public static readonly Histogram<double> ExternalCallDuration = Meter.CreateHistogram<double>(
        "quant-platform.external.duration.ms",
        unit: "ms");

    public static readonly Histogram<double> QueueWaitDuration = Meter.CreateHistogram<double>(
        "quant-platform.queue.wait.ms",
        unit: "ms");

    public static readonly Histogram<double> DbPoolWaitDuration = Meter.CreateHistogram<double>(
        "quant-platform.db.pool.wait.ms",
        unit: "ms");

    public static readonly Counter<long> BackgroundJobCount = Meter.CreateCounter<long>(
        "quant-platform.background.job.count");

    private static long _activeDbConnections;
    private static double _mainThreadLagMs;

    static GatewayTelemetry()
    {
        Meter.CreateObservableGauge(
            "quant-platform.db.pool.in_use",
            () => new Measurement<long>(Interlocked.Read(ref _activeDbConnections)));

        Meter.CreateObservableGauge(
            "quant-platform.runtime.main_thread_lag.ms",
            () => new Measurement<double>(Volatile.Read(ref _mainThreadLagMs)));

        Meter.CreateObservableGauge(
            "quant-platform.worker.utilization",
            ObserveWorkerUtilization);
    }

    public static void IncrementDbConnections() => Interlocked.Increment(ref _activeDbConnections);

    public static void DecrementDbConnections() => Interlocked.Decrement(ref _activeDbConnections);

    public static void SetMainThreadLagMs(double value) => Volatile.Write(ref _mainThreadLagMs, value);

    private static IEnumerable<Measurement<double>> ObserveWorkerUtilization()
    {
        ThreadPool.GetMaxThreads(out var maxWorker, out _);
        ThreadPool.GetAvailableThreads(out var availableWorker, out _);
        var busy = maxWorker - availableWorker;
        var utilization = maxWorker == 0 ? 0 : (double)busy / maxWorker;
        return new[] { new Measurement<double>(utilization) };
    }
}
