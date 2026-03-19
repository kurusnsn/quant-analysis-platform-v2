using QuantPlatform.Gateway.Services;

namespace QuantPlatform.Gateway.Middleware;

public sealed class TrialAccessMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<TrialAccessMiddleware> _logger;

    public TrialAccessMiddleware(RequestDelegate next, ILogger<TrialAccessMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, TrialAccessService trialAccess)
    {
        if (!ShouldEvaluate(context))
        {
            await _next(context);
            return;
        }

        var evaluation = await trialAccess.EvaluateAsync(context.User, context.RequestAborted);
        if (!evaluation.IsLocked)
        {
            await _next(context);
            return;
        }

        _logger.LogInformation(
            "Trial lock enforced for {Path}. Trial ended at {TrialEndsAt}",
            context.Request.Path,
            evaluation.TrialEndsAt);

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.ContentType = "application/json";
        context.Response.Headers["X-QuantPlatform-Upgrade-Required"] = "trial_expired";

        await context.Response.WriteAsJsonAsync(new
        {
            error = $"Your {evaluation.TrialDays}-day trial has ended. Upgrade to continue with write actions.",
            code = "trial_expired",
            trialDays = evaluation.TrialDays,
            trialStartedAt = evaluation.TrialStartedAt,
            trialEndsAt = evaluation.TrialEndsAt,
            upgradePath = "/settings/billing"
        });
    }

    private static bool ShouldEvaluate(HttpContext context)
    {
        if (context.User?.Identity?.IsAuthenticated != true)
        {
            return false;
        }

        var method = context.Request.Method;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
        {
            return false;
        }

        var path = context.Request.Path;
        if (!path.StartsWithSegments("/api"))
        {
            return false;
        }

        if (path.StartsWithSegments("/api/billing") || path.StartsWithSegments("/api/users"))
        {
            return false;
        }

        return true;
    }
}
