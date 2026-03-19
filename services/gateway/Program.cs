using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.HttpOverrides;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Config;
using QuantPlatform.Gateway.Services;
using QuantPlatform.Gateway.Jobs;
using Hangfire;
using Hangfire.PostgreSql;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using QuantPlatform.Gateway.Observability;
using System.Net;
using System.Diagnostics;
using System.Globalization;
using System.Security.Claims;
using System.Threading.RateLimiting;
using QuantPlatform.Gateway.Middleware;

var builder = WebApplication.CreateBuilder(args);

var isEfTooling = AppDomain.CurrentDomain.GetAssemblies().Any(a =>
    string.Equals(a.GetName().Name, "Microsoft.EntityFrameworkCore.Design", StringComparison.OrdinalIgnoreCase));

// Sentry error tracking (optional)
var sentryDsn = builder.Configuration["SENTRY_DSN"];
var isSentryEnabled = !string.IsNullOrWhiteSpace(sentryDsn) &&
    !string.Equals(sentryDsn, "REPLACE_ME", StringComparison.OrdinalIgnoreCase);
if (isSentryEnabled)
{
    builder.WebHost.UseSentry(o =>
    {
        o.Dsn = sentryDsn;
        o.Debug = builder.Environment.IsDevelopment();
        o.TracesSampleRate = 1.0;
        o.Environment = builder.Environment.EnvironmentName;
    });
}

// OpenTelemetry Configuration
var otelEndpoint = builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4317";
var serviceName = builder.Configuration["OTEL_SERVICE_NAME"] ?? "quant-platform-gateway";

builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService(serviceName)
        .AddAttributes(new Dictionary<string, object>
        {
            ["service.namespace"] = "quant-platform",
            ["deployment.environment"] = builder.Environment.EnvironmentName
        }))
    .WithTracing(tracing => tracing
        .AddSource(GatewayTelemetry.ActivitySourceName)
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter(opts => opts.Endpoint = new Uri(otelEndpoint)))
    .WithMetrics(metrics => metrics
        .AddMeter(GatewayTelemetry.MeterName)
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter(opts => opts.Endpoint = new Uri(otelEndpoint)));

// Configure CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("QuantPlatformCors", policy =>
    {
        policy.SetIsOriginAllowed(origin =>
            IsAllowedCorsOrigin(origin, new[]
            {
                "https://quant-platform.com",
                "http://46.224.4.132:3000"
            }))
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// Add services
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddMemoryCache();
builder.Services.AddHttpContextAccessor();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, token) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            context.HttpContext.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds)
                .ToString(CultureInfo.InvariantCulture);
        }

        if (!context.HttpContext.Response.HasStarted)
        {
            context.HttpContext.Response.ContentType = "application/json";
            await context.HttpContext.Response.WriteAsJsonAsync(
                new { error = "Too many requests. Please retry shortly." },
                cancellationToken: token);
        }
    };

    options.AddPolicy("billing-read", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: GetRateLimitPartitionKey(context, "billing-read"),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));

    options.AddPolicy("billing-write", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: GetRateLimitPartitionKey(context, "billing-write"),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));

    options.AddPolicy("billing-webhook", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: GetRateLimitPartitionKey(context, "billing-webhook"),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));

    options.AddPolicy("ai-generate", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: GetRateLimitPartitionKey(context, "ai-generate"),
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 20,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});

// NextAuth JWT validation
builder.Services.AddNextAuth(builder.Configuration);

// Observability helpers
builder.Services.AddSingleton<DbSessionUserInterceptor>();
builder.Services.AddSingleton<DbPoolWaitInterceptor>();
builder.Services.AddSingleton<DbCommandSpanInterceptor>();
builder.Services.AddTransient<ExternalApiHandler>();
builder.Services.AddScoped<TrialAccessService>();
if (!isEfTooling)
{
    builder.Services.AddHostedService<MainThreadLagMonitor>();
}

// Add DbContext with Postgres
var connectionString = DbConnection.RequireDefaultConnectionString(builder.Configuration);

// Add Storage Service (S3)
builder.Services.AddSingleton<IStorageService, S3StorageService>();

// Add Hangfire
if (!isEfTooling)
{
    builder.Services.AddHangfire(config => config
        .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
        .UseSimpleAssemblyNameTypeSerializer()
        .UseRecommendedSerializerSettings()
        .UsePostgreSqlStorage(options => options.UseNpgsqlConnection(connectionString)));

    builder.Services.AddHangfireServer();
    GlobalJobFilters.Filters.Add(new QueueWaitFilter());

    // Add job
    builder.Services.AddScoped<DailyRiskUpdateJob>();
}

builder.Services.AddDbContext<QuantPlatformDbContext>((sp, options) =>
    options.UseNpgsql(connectionString)
        .AddInterceptors(
            sp.GetRequiredService<DbSessionUserInterceptor>(),
            sp.GetRequiredService<DbPoolWaitInterceptor>(),
            sp.GetRequiredService<DbCommandSpanInterceptor>()));

// Add HttpClient for AI Engine calls
builder.Services.AddHttpClient("AIEngine", client =>
{
    var aiUrl = builder.Configuration["AI_SERVICE_URL"] ?? "http://localhost:5000";
    client.BaseAddress = new Uri(aiUrl);
    client.Timeout = TimeSpan.FromSeconds(30);
}).AddHttpMessageHandler<ExternalApiHandler>();

var app = builder.Build();

// Apply migrations on startup (dev only)
if (app.Environment.IsDevelopment() && !isEfTooling)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<QuantPlatformDbContext>();
    db.Database.Migrate();
}

// Configure pipeline
if (isSentryEnabled)
{
    app.UseSentryTracing();
}
app.UseForwardedHeaders();
app.UseCors("QuantPlatformCors");
app.UseMiddleware<RequestMetricsMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Auth middleware
app.UseAuthentication();
app.UseRateLimiter();
if (app.Environment.IsDevelopment())
{
    app.Use(async (context, next) =>
    {
        using var activity = GatewayTelemetry.ActivitySource.StartActivity("auth.verification.dev", ActivityKind.Internal);
        if (context.User?.Identity?.IsAuthenticated != true &&
            IsLocalDevAuthRequest(context) &&
            context.Request.Headers.TryGetValue(DevAuth.HeaderName, out var headerValue))
        {
            var principal = DevAuth.TryCreatePrincipal(headerValue);
            if (principal != null)
            {
                context.User = principal;
                activity?.SetTag("auth.result", "validated");
            }
            else
            {
                activity?.SetTag("auth.result", "failed");
            }
        }

        await next();
    });
}
app.UseMiddleware<TrialAccessMiddleware>();
app.UseAuthorization();
app.UseMiddleware<RequestMetricsMiddleware>();

// Health endpoints
app.MapGet("/health", () => Results.Ok(new { status = "healthy", service = "gateway" }));
app.MapGet("/api/health", () => Results.Ok(new { status = "healthy", service = "gateway" }));

app.MapGet("/health/db", DatabaseHealthResult);
app.MapGet("/api/health/db", DatabaseHealthResult);

if (!isEfTooling)
{
    // Configure Hangfire Dashboard
    app.UseHangfireDashboard("/hangfire", new DashboardOptions
    {
        Authorization = new[] { new Hangfire.Dashboard.LocalRequestsOnlyAuthorizationFilter() }
    });

    // Schedule recurring jobs
    using (var scope = app.Services.CreateScope())
    {
        var recurringJobManager = scope.ServiceProvider.GetRequiredService<IRecurringJobManager>();
        recurringJobManager.AddOrUpdate<DailyRiskUpdateJob>(
            "daily-risk-recalculation",
            job => job.ExecuteAsync(),
            Cron.Daily);
    }
}

app.MapControllers();

// When EF tooling runs, it may execute Program to resolve services; don't start the web host in that case.
if (isEfTooling)
{
    return;
}

app.Run();

static bool IsAllowedCorsOrigin(string origin, IReadOnlyCollection<string> explicitOrigins)
{
    if (string.IsNullOrWhiteSpace(origin))
    {
        return false;
    }

    if (explicitOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
    {
        return true;
    }

    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
    {
        return false;
    }

    if (!string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) &&
        !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
    {
        return false;
    }

    return string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase) ||
           string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase);
}

static string GetRateLimitPartitionKey(HttpContext context, string policy)
{
    var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? context.User.FindFirst("sub")?.Value;

    if (!string.IsNullOrWhiteSpace(userId))
    {
        return $"{policy}:user:{userId}";
    }

    var ip = context.Connection.RemoteIpAddress?.ToString();
    if (!string.IsNullOrWhiteSpace(ip))
    {
        return $"{policy}:ip:{ip}";
    }

    return $"{policy}:ip:unknown";
}

static bool IsLocalDevAuthRequest(HttpContext context)
{
    // Dev auth header bypass must never be enabled for public internet traffic.
    // Allow only when the request host is local AND the real client IP is local/private.
    var host = context.Request.Host.Host;
    if (!string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) &&
        !string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase))
    {
        return false;
    }

    IPAddress? clientIp = null;
    var realIpHeader = context.Request.Headers["X-Real-IP"].FirstOrDefault();
    if (!string.IsNullOrWhiteSpace(realIpHeader) && IPAddress.TryParse(realIpHeader, out var parsedRealIp))
    {
        clientIp = parsedRealIp;
    }
    else
    {
        clientIp = context.Connection.RemoteIpAddress;
    }

    return IsPrivateOrLoopback(clientIp);
}

static bool IsPrivateOrLoopback(IPAddress? ip)
{
    if (ip == null)
    {
        return false;
    }

    if (ip.IsIPv4MappedToIPv6)
    {
        return IsPrivateOrLoopback(ip.MapToIPv4());
    }

    if (IPAddress.IsLoopback(ip))
    {
        return true;
    }

    if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
    {
        var bytes = ip.GetAddressBytes();
        if (bytes[0] == 10)
        {
            return true;
        }

        if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
        {
            return true;
        }

        if (bytes[0] == 192 && bytes[1] == 168)
        {
            return true;
        }
    }

    if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
    {
        // fc00::/7 unique local addresses
        var bytes = ip.GetAddressBytes();
        return (bytes[0] & 0xFE) == 0xFC;
    }

    return false;
}

static async Task<IResult> DatabaseHealthResult(
    QuantPlatformDbContext db,
    IWebHostEnvironment environment,
    ILoggerFactory loggerFactory)
{
    try
    {
        await db.Database.CanConnectAsync();
        return Results.Ok(new { status = "healthy", database = "connected" });
    }
    catch (Exception ex)
    {
        loggerFactory.CreateLogger("DatabaseHealth")
            .LogError(ex, "Database connectivity check failed");

        if (environment.IsDevelopment())
        {
            return Results.Json(new { status = "unhealthy", error = ex.Message }, statusCode: 503);
        }

        return Results.Json(new { status = "unhealthy", error = "database_unavailable" }, statusCode: 503);
    }
}
