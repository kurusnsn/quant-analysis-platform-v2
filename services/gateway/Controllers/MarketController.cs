using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;

namespace QuantPlatform.Gateway.Controllers;

[ApiController]
[Route("api/market")]
[Authorize(Policy = "Authenticated")]
public class MarketController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly QuantPlatformDbContext _db;
    private readonly ILogger<MarketController> _logger;

    public MarketController(
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        QuantPlatformDbContext db,
        ILogger<MarketController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _db = db;
        _logger = logger;
    }

    [HttpGet("synthesis")]
    public async Task<IActionResult> GetMarketSynthesis()
    {
        const string cacheKey = "market_synthesis";
        var userId = User.GetUserGuid();

        // Check cache first
        if (_cache.TryGetValue(cacheKey, out string? cachedContent) && cachedContent != null)
        {
            _logger.LogInformation("Returning cached market synthesis");
            Response.Headers.Append("X-Cache", "HIT");

            await TryRecordMarketOverviewHistoryAsync(userId, cachedContent);
            return Content(cachedContent, "application/json");
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var response = await client.PostAsync("/market/synthesis", null);
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("AI Engine returned error: {StatusCode}", response.StatusCode);
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            // Determine cache duration based on time of day
            var now = DateTime.Now;
            var isMarketHours = now.Hour >= 9 && now.Hour < 16; // 9 AM - 4 PM EST (simplified)
            var cacheDuration = isMarketHours ? TimeSpan.FromHours(1) : TimeSpan.FromHours(4);

            // Cache the response
            _cache.Set(cacheKey, content, cacheDuration);
            _logger.LogInformation("Cached market synthesis for {Duration}", cacheDuration);

            Response.Headers.Append("X-Cache", "MISS");
            Response.Headers.Append("Cache-Control", $"public, max-age={cacheDuration.TotalSeconds}");

            await TryRecordMarketOverviewHistoryAsync(userId, content);
            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Failed to connect to AI Engine");
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    [HttpGet("ticker-commentary/{symbol}")]
    public async Task<IActionResult> GetTickerCommentary(string symbol)
    {
        // Validate symbol
        if (string.IsNullOrWhiteSpace(symbol) || symbol.Length > 10 ||
            !System.Text.RegularExpressions.Regex.IsMatch(symbol, @"^[A-Za-z0-9.\-]+$"))
        {
            return BadRequest(new { error = "Invalid symbol" });
        }

        var safeSymbol = symbol.ToUpperInvariant();
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
        var cacheKey = $"ticker_commentary_{safeSymbol}_{today}";

        if (_cache.TryGetValue(cacheKey, out string? cachedContent) && cachedContent != null)
        {
            Response.Headers.Append("X-Cache", "HIT");
            return Content(cachedContent, "application/json");
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var response = await client.GetAsync($"/market/ticker-commentary/{safeSymbol}");
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
                return StatusCode((int)response.StatusCode, new { error = content });

            var now = DateTime.Now;
            var cacheDuration = (now.Hour >= 9 && now.Hour < 16)
                ? TimeSpan.FromHours(1)
                : TimeSpan.FromHours(4);

            _cache.Set(cacheKey, content, cacheDuration);
            Response.Headers.Append("X-Cache", "MISS");
            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Failed to fetch ticker commentary for {Symbol}", safeSymbol);
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    private async Task TryRecordMarketOverviewHistoryAsync(Guid? userId, string payload)
    {
        if (userId == null)
        {
            return;
        }

        try
        {
            var userGuid = userId.Value;
            var safePayload = EnsureJson(payload);

            // Basic de-dupe: if the last market overview payload equals this payload, don't insert again.
            var lastPayload = await _db.HistoryItems
                .AsNoTracking()
                .Where(h => h.UserId == userGuid && h.Kind == HistoryKinds.MarketOverview)
                .OrderByDescending(h => h.CreatedAt)
                .Select(h => h.Payload)
                .FirstOrDefaultAsync();

            if (lastPayload == safePayload)
            {
                return;
            }

            _db.HistoryItems.Add(new HistoryItem
            {
                UserId = userGuid,
                Kind = HistoryKinds.MarketOverview,
                Title = "Market Overview",
                Tickers = Array.Empty<string>(),
                Payload = safePayload
            });

            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to record market overview history");
        }
    }

    private static string EnsureJson(string payload)
    {
        if (string.IsNullOrWhiteSpace(payload))
        {
            return "{}";
        }

        try
        {
            JsonDocument.Parse(payload);
            return payload;
        }
        catch
        {
            return JsonSerializer.Serialize(new { raw = payload });
        }
    }
}
