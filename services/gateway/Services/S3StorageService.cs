using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Configuration;
using System.Diagnostics;
using System.Diagnostics.Metrics;
using OpenTelemetry.Trace;
using QuantPlatform.Gateway.Observability;
using OpenTelemetry.Trace;

namespace QuantPlatform.Gateway.Services;

public class S3StorageService : IStorageService
{
    private readonly IAmazonS3? _s3Client;
    private readonly string _bucketName;
    private readonly ILogger<S3StorageService> _logger;
    private readonly bool _enabled;

    public S3StorageService(IConfiguration config, ILogger<S3StorageService> logger)
    {
        _logger = logger;
        _bucketName = config["S3_BUCKET_NAME"] ?? "quant-platform-reports";

        var accessKey = config["S3_ACCESS_KEY"];
        var secretKey = config["S3_SECRET_KEY"];
        var serviceUrlRaw = config["S3_SERVICE_URL"]; // e.g., https://nbg1.your-objectstorage.com
        var serviceUrl = NormalizeServiceUrl(serviceUrlRaw);

        _enabled = !string.IsNullOrWhiteSpace(accessKey)
            && !string.IsNullOrWhiteSpace(secretKey)
            && !string.IsNullOrWhiteSpace(serviceUrl);

        if (!_enabled)
        {
            _logger.LogWarning(
                "⚠️ S3 storage configuration is incomplete. Disabling report storage (set S3_ACCESS_KEY, S3_SECRET_KEY, S3_SERVICE_URL)."
            );
            _s3Client = null;
            return;
        }

        if (!Uri.TryCreate(serviceUrl, UriKind.Absolute, out var parsedUrl) ||
            (parsedUrl.Scheme != Uri.UriSchemeHttp && parsedUrl.Scheme != Uri.UriSchemeHttps))
        {
            _logger.LogError("⚠️ Invalid S3_SERVICE_URL '{ServiceUrl}'. Disabling report storage.", serviceUrlRaw);
            _enabled = false;
            _s3Client = null;
            return;
        }

        try
        {
            var s3Config = new AmazonS3Config
            {
                // Keep user-provided URL (normalized) as-is; AWS SDK requires a valid absolute URL.
                ServiceURL = parsedUrl.ToString().TrimEnd('/'),
                ForcePathStyle = true // Required for Hetzner Object Storage
            };

            _s3Client = new AmazonS3Client(accessKey, secretKey, s3Config);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "⚠️ Failed to configure S3 client. Disabling report storage.");
            _enabled = false;
            _s3Client = null;
        }
    }

    private static string? NormalizeServiceUrl(string? serviceUrl)
    {
        if (string.IsNullOrWhiteSpace(serviceUrl))
        {
            return null;
        }

        var trimmed = serviceUrl.Trim();
        if (!trimmed.Contains("://", StringComparison.Ordinal))
        {
            // Users often paste Hetzner endpoints without scheme; default to HTTPS.
            trimmed = $"https://{trimmed}";
        }

        return trimmed;
    }

    public async Task<string> SaveReportAsync(string reportName, string content, string contentType = "application/json")
    {
        if (!_enabled || _s3Client == null)
        {
            // Keep watchlist analysis usable without S3 configured; callers already treat empty keys as "no report".
            _logger.LogInformation("S3 storage disabled; skipping SaveReportAsync for {ReportName}.", reportName);
            return string.Empty;
        }

        using var activity = GatewayTelemetry.ActivitySource.StartActivity("external_api.wait", ActivityKind.Client);
        activity?.SetTag("peer.service", "s3");
        activity?.SetTag("aws.bucket", _bucketName);
        activity?.SetTag("aws.operation", "PutObject");
        var sw = Stopwatch.StartNew();
        try
        {
            var key = $"{DateTime.UtcNow:yyyy/MM/dd}/{Guid.NewGuid()}-{reportName}";
            
            var request = new PutObjectRequest
            {
                BucketName = _bucketName,
                Key = key,
                ContentBody = content,
                ContentType = contentType
            };

            await _s3Client.PutObjectAsync(request);
            
            _logger.LogInformation("✅ Report saved to S3: {Key}", key);
            return key;
        }
        catch (Exception ex)
        {
            activity?.RecordException(ex);
            activity?.SetTag("error", true);
            _logger.LogError(ex, "❌ Failed to save report to S3");
            throw;
        }
        finally
        {
            sw.Stop();
            var tags = new TagList
            {
                { "peer.service", "s3" },
                { "aws.operation", "PutObject" }
            };
            GatewayTelemetry.ExternalCallDuration.Record(sw.Elapsed.TotalMilliseconds, tags);
        }
    }

    public async Task<string> GetReportAsync(string reportId)
    {
        if (!_enabled || _s3Client == null)
        {
            throw new InvalidOperationException("S3 storage is disabled (missing S3 configuration).");
        }

        using var activity = GatewayTelemetry.ActivitySource.StartActivity("external_api.wait", ActivityKind.Client);
        activity?.SetTag("peer.service", "s3");
        activity?.SetTag("aws.bucket", _bucketName);
        activity?.SetTag("aws.operation", "GetObject");
        var sw = Stopwatch.StartNew();
        try
        {
            var request = new GetObjectRequest
            {
                BucketName = _bucketName,
                Key = reportId
            };

            using var response = await _s3Client.GetObjectAsync(request);
            using var reader = new StreamReader(response.ResponseStream);
            return await reader.ReadToEndAsync();
        }
        catch (Exception ex)
        {
            activity?.RecordException(ex);
            activity?.SetTag("error", true);
            _logger.LogError(ex, "❌ Failed to get report from S3: {Key}", reportId);
            throw;
        }
        finally
        {
            sw.Stop();
            var tags = new TagList
            {
                { "peer.service", "s3" },
                { "aws.operation", "GetObject" }
            };
            GatewayTelemetry.ExternalCallDuration.Record(sw.Elapsed.TotalMilliseconds, tags);
        }
    }

    public async Task DeleteReportAsync(string reportId)
    {
        if (!_enabled || _s3Client == null)
        {
            throw new InvalidOperationException("S3 storage is disabled (missing S3 configuration).");
        }

        using var activity = GatewayTelemetry.ActivitySource.StartActivity("external_api.wait", ActivityKind.Client);
        activity?.SetTag("peer.service", "s3");
        activity?.SetTag("aws.bucket", _bucketName);
        activity?.SetTag("aws.operation", "DeleteObject");
        var sw = Stopwatch.StartNew();
        try
        {
            var request = new DeleteObjectRequest
            {
                BucketName = _bucketName,
                Key = reportId
            };

            await _s3Client.DeleteObjectAsync(request);
            _logger.LogInformation("🗑️ Report deleted from S3: {Key}", reportId);
        }
        catch (Exception ex)
        {
            activity?.RecordException(ex);
            activity?.SetTag("error", true);
            _logger.LogError(ex, "❌ Failed to delete report from S3: {Key}", reportId);
            throw;
        }
        finally
        {
            sw.Stop();
            var tags = new TagList
            {
                { "peer.service", "s3" },
                { "aws.operation", "DeleteObject" }
            };
            GatewayTelemetry.ExternalCallDuration.Record(sw.Elapsed.TotalMilliseconds, tags);
        }
    }
}
