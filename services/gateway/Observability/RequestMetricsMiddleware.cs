using System.Diagnostics;
using System.Diagnostics.Metrics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace QuantPlatform.Gateway.Observability;

public sealed class RequestMetricsMiddleware
{
    private readonly RequestDelegate _next;

    public RequestMetricsMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task Invoke(HttpContext context)
    {
        var sw = Stopwatch.StartNew();
        var exceptionThrown = false;

        try
        {
            await _next(context);
        }
        catch
        {
            exceptionThrown = true;
            throw;
        }
        finally
        {
            sw.Stop();

            var statusCode = exceptionThrown
                ? StatusCodes.Status500InternalServerError
                : context.Response.StatusCode;

            var route = "unmatched";
            if (context.GetEndpoint() is RouteEndpoint routeEndpoint && routeEndpoint.RoutePattern?.RawText is { Length: > 0 } rawText)
            {
                route = rawText;
            }

            var tags = new TagList
            {
                { "http.method", context.Request.Method },
                { "http.route", route },
                { "http.status_code", statusCode }
            };

            GatewayTelemetry.RequestDuration.Record(sw.Elapsed.TotalMilliseconds, tags);
            GatewayTelemetry.RequestCount.Add(1, tags);

            if (statusCode >= 500)
            {
                GatewayTelemetry.ErrorCount.Add(1, tags);
            }
        }
    }
}
