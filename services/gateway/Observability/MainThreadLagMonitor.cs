using System.Diagnostics;
using Microsoft.Extensions.Hosting;

namespace QuantPlatform.Gateway.Observability;

public sealed class MainThreadLagMonitor : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMilliseconds(500);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var timer = new PeriodicTimer(Interval);
        var intervalTicks = (long)(Interval.TotalSeconds * Stopwatch.Frequency);
        var expected = Stopwatch.GetTimestamp() + intervalTicks;

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            var now = Stopwatch.GetTimestamp();
            var lagTicks = now - expected;
            if (lagTicks < 0)
            {
                lagTicks = 0;
            }

            var lagMs = lagTicks * 1000.0 / Stopwatch.Frequency;
            GatewayTelemetry.SetMainThreadLagMs(lagMs);
            expected = now + intervalTicks;
        }
    }
}
