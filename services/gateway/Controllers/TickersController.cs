using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;
using QuantPlatform.Gateway.Services;
using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace QuantPlatform.Gateway.Controllers;

[ApiController]
[Route("api/tickers")]
[Authorize(Policy = "Authenticated")]
public class TickersController : ControllerBase
{
    private const string RefreshTokenHeaderName = "X-Internal-Refresh-Token";

    private readonly QuantPlatformDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;

    public TickersController(QuantPlatformDbContext context, IHttpClientFactory httpClientFactory, IConfiguration configuration)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
    }

    [AllowAnonymous]
    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 1)
        {
            return Ok(new List<object>());
        }

        var normalizedQuery = q.Trim().ToUpperInvariant();

        // 1. Search local cache first
        var localResults = await _context.TickerMetadata
            .Where(t => t.Symbol.Contains(normalizedQuery) || t.Name.ToUpper().Contains(normalizedQuery))
            .OrderByDescending(t => t.Symbol.StartsWith(normalizedQuery))
            .ThenBy(t => t.Symbol)
            .Take(15)
            .ToListAsync();

        if (localResults.Count >= 5)
        {
            return Ok(localResults);
        }

        // 2. If not enough results, hit Polygon (Massive) API
        var apiKey = _configuration["MASSIVE_API_KEY"];
        if (string.IsNullOrEmpty(apiKey))
        {
            return Ok(localResults);
        }

        try
        {
            var client = _httpClientFactory.CreateClient();
            var url = $"https://api.polygon.io/v3/reference/tickers?search={Uri.EscapeDataString(q)}&market=stocks&active=true&limit=10&apiKey={apiKey}";
            
            var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode)
            {
                return Ok(localResults);
            }

            var data = await response.Content.ReadFromJsonAsync<PolygonTickersResponse>();
            var externalResults = data?.Results ?? new List<PolygonTicker>();

            // 3. Merge and cache new results asynchronously
            foreach (var ext in externalResults)
            {
                if (!localResults.Any(l => l.Symbol == ext.Ticker))
                {
                    var existing = await _context.TickerMetadata.FindAsync(ext.Ticker);
                    if (existing == null)
                    {
                        var newTicker = new TickerMetadata
                        {
                            Symbol = ext.Ticker,
                            Name = ext.Name,
                            Exchange = ext.PrimaryExchange,
                            UpdatedAt = DateTime.UtcNow
                        };
                        _context.TickerMetadata.Add(newTicker);
                        localResults.Add(newTicker);
                    }
                }
            }

            await _context.SaveChangesAsync();
            return Ok(localResults.OrderBy(l => l.Symbol).Take(15));
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error searching tickers: {ex.Message}");
            return Ok(localResults);
        }
    }

    [AllowAnonymous]
    [HttpGet("{ticker}/logo")]
    public async Task<IActionResult> GetLogo(string ticker)
    {
        var normalizedTicker = TickerValidation.Normalize(ticker);
        var metadata = await _context.TickerMetadata.FindAsync(normalizedTicker);

        if (metadata != null && !string.IsNullOrEmpty(metadata.IconUrl))
        {
            return Ok(new { ticker = normalizedTicker, iconUrl = metadata.IconUrl, logoUrl = metadata.LogoUrl });
        }

        // Fetch from API if missing
        var apiKey = _configuration["MASSIVE_API_KEY"];
        if (string.IsNullOrEmpty(apiKey)) return NotFound();

        try
        {
            var client = _httpClientFactory.CreateClient();
            var url = $"https://api.polygon.io/v3/reference/tickers/{normalizedTicker}?apiKey={apiKey}";
            
            var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode) return NotFound();

            var data = await response.Content.ReadFromJsonAsync<PolygonTickerDetailResponse>();
            var results = data?.Results;

            if (results?.Branding != null)
            {
                if (metadata == null)
                {
                    metadata = new TickerMetadata
                    {
                        Symbol = normalizedTicker,
                        Name = results.Name,
                        Exchange = results.PrimaryExchange,
                        UpdatedAt = DateTime.UtcNow
                    };
                    _context.TickerMetadata.Add(metadata);
                }

                metadata.IconUrl = results.Branding.IconUrl != null ? $"{results.Branding.IconUrl}?apiKey={apiKey}" : null;
                metadata.LogoUrl = results.Branding.LogoUrl != null ? $"{results.Branding.LogoUrl}?apiKey={apiKey}" : null;
                metadata.UpdatedAt = DateTime.UtcNow;

                await _context.SaveChangesAsync();
                return Ok(new { ticker = normalizedTicker, iconUrl = metadata.IconUrl, logoUrl = metadata.LogoUrl });
            }

            return NotFound();
        }
        catch
        {
            return NotFound();
        }
    }

    [HttpPost("refresh")]
    [AllowAnonymous] // Should be protected by internal network / secret key in production
    public async Task<IActionResult> Refresh([FromQuery] string? secret)
    {
        var internalSecret = _configuration["INTERNAL_API_SECRET"];
        if (string.IsNullOrWhiteSpace(internalSecret))
        {
            return Unauthorized();
        }

        if (!IsPrivateOrLoopback(GetRequestIp(HttpContext)))
        {
            return Forbid();
        }

        var providedSecret = Request.Headers[RefreshTokenHeaderName].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(providedSecret))
        {
            // Backward compatibility for existing tooling.
            providedSecret = secret;
        }

        if (!SecretsMatch(providedSecret, internalSecret))
        {
            return Unauthorized();
        }

        var apiKey = _configuration["MASSIVE_API_KEY"];
        if (string.IsNullOrEmpty(apiKey)) return BadRequest("MASSIVE_API_KEY missing");

        try
        {
            var client = _httpClientFactory.CreateClient();
            var allTickers = new List<PolygonTicker>();
            var nextUrl = $"https://api.polygon.io/v3/reference/tickers?market=stocks&active=true&limit=1000&apiKey={apiKey}";

            while (!string.IsNullOrEmpty(nextUrl))
            {
                var response = await client.GetAsync(nextUrl);
                if (!response.IsSuccessStatusCode) break;

                var data = await response.Content.ReadFromJsonAsync<PolygonTickersResponse>();
                if (data?.Results != null)
                {
                    allTickers.AddRange(data.Results);
                }

                nextUrl = data?.NextUrl;
                if (!string.IsNullOrEmpty(nextUrl))
                {
                    nextUrl = $"{nextUrl}&apiKey={apiKey}";
                    await Task.Delay(12000); // 5 req/min
                }
            }

            // Batch update database
            foreach (var t in allTickers)
            {
                var existing = await _context.TickerMetadata.FindAsync(t.Ticker);
                if (existing == null)
                {
                    _context.TickerMetadata.Add(new TickerMetadata
                    {
                        Symbol = t.Ticker,
                        Name = t.Name,
                        Exchange = t.PrimaryExchange,
                        UpdatedAt = DateTime.UtcNow
                    });
                }
                else
                {
                    existing.Name = t.Name;
                    existing.Exchange = t.PrimaryExchange;
                    existing.UpdatedAt = DateTime.UtcNow;
                }
            }

            await _context.SaveChangesAsync();
            return Ok(new { total = allTickers.Count });
        }
        catch (Exception ex)
        {
            return StatusCode(500, ex.Message);
        }
    }

    // Helper classes for Polygon API
    private class PolygonTickersResponse
    {
        public List<PolygonTicker>? Results { get; set; }
        
        [System.Text.Json.Serialization.JsonPropertyName("next_url")]
        public string? NextUrl { get; set; }
    }

    private class PolygonTicker
    {
        public string Ticker { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? PrimaryExchange { get; set; }
    }

    private class PolygonTickerDetailResponse
    {
        public PolygonTickerDetail? Results { get; set; }
    }

    private class PolygonTickerDetail
    {
        public string Ticker { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? PrimaryExchange { get; set; }
        public PolygonBranding? Branding { get; set; }
    }

    private class PolygonBranding
    {
        [System.Text.Json.Serialization.JsonPropertyName("icon_url")]
        public string? IconUrl { get; set; }
        
        [System.Text.Json.Serialization.JsonPropertyName("logo_url")]
        public string? LogoUrl { get; set; }
    }

    private static bool SecretsMatch(string? providedSecret, string expectedSecret)
    {
        if (string.IsNullOrWhiteSpace(providedSecret))
        {
            return false;
        }

        var providedBytes = Encoding.UTF8.GetBytes(providedSecret.Trim());
        var expectedBytes = Encoding.UTF8.GetBytes(expectedSecret.Trim());
        return CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
    }

    private static IPAddress? GetRequestIp(HttpContext context)
    {
        var realIpHeader = context.Request.Headers["X-Real-IP"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(realIpHeader) && IPAddress.TryParse(realIpHeader, out var parsedIp))
        {
            return parsedIp;
        }

        return context.Connection.RemoteIpAddress;
    }

    private static bool IsPrivateOrLoopback(IPAddress? ip)
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
            var bytes = ip.GetAddressBytes();
            return (bytes[0] & 0xFE) == 0xFC;
        }

        return false;
    }
}
