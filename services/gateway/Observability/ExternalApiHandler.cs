using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Net.Http;
using OpenTelemetry.Trace;

namespace QuantPlatform.Gateway.Observability;

public sealed class ExternalApiHandler : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var route = request.RequestUri?.AbsolutePath ?? "unknown";
        using var activity = GatewayTelemetry.ActivitySource.StartActivity("external_api.wait", ActivityKind.Client);

        activity?.SetTag("peer.service", "ai-engine");
        activity?.SetTag("http.method", request.Method.Method);
        activity?.SetTag("http.route", route);

        var sw = Stopwatch.StartNew();
        try
        {
            var response = await base.SendAsync(request, cancellationToken);
            activity?.SetTag("http.status_code", (int)response.StatusCode);
            return response;
        }
        catch (Exception ex)
        {
            activity?.RecordException(ex);
            activity?.SetTag("error", true);
            throw;
        }
        finally
        {
            sw.Stop();
            var tags = new TagList
            {
                { "peer.service", "ai-engine" },
                { "http.route", route },
                { "http.method", request.Method.Method }
            };
            GatewayTelemetry.ExternalCallDuration.Record(sw.Elapsed.TotalMilliseconds, tags);
        }
    }
}
