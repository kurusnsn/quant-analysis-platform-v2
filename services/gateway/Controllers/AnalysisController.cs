using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;
using QuantPlatform.Gateway.Services;

namespace QuantPlatform.Gateway.Controllers;

[ApiController]
[Route("api/analysis")]
[Authorize(Policy = "Authenticated")]
public class AnalysisController : ControllerBase
{
    private readonly QuantPlatformDbContext _db;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<AnalysisController> _logger;

    public AnalysisController(
        QuantPlatformDbContext db,
        IHttpClientFactory httpClientFactory,
        ILogger<AnalysisController> logger)
    {
        _db = db;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    [HttpPost("asset")]
    public async Task<IActionResult> AnalyzeAsset([FromBody] AssetRequest request)
    {
        if (request.Tickers == null || !request.Tickers.Any())
        {
            return BadRequest(new { error = "No tickers provided" });
        }

        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var invalidTicker = request.Tickers.FirstOrDefault(t => !TickerValidation.IsValid(t));
        if (invalidTicker != null)
        {
            return BadRequest(new { error = "Invalid ticker format", ticker = invalidTicker });
        }

        var normalizedTickers = request.Tickers
            .Select(TickerValidation.Normalize)
            .ToList();

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var response = await client.PostAsJsonAsync("/analyze/asset", new { tickers = normalizedTickers });
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            await TryRecordAssetAnalysisHistory(userId.Value, normalizedTickers, content);
            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    [HttpPost("watchlist")]
    public async Task<IActionResult> AnalyzeWatchlist([FromBody] WatchlistAnalysisRequest request)
    {
        if (request.Tickers == null || !request.Tickers.Any())
        {
            return BadRequest(new { error = "No tickers provided" });
        }

        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var invalidTicker = request.Tickers.FirstOrDefault(t => !TickerValidation.IsValid(t));
        if (invalidTicker != null)
        {
            return BadRequest(new { error = "Invalid ticker format", ticker = invalidTicker });
        }

        var normalizedTickers = request.Tickers
            .Select(TickerValidation.Normalize)
            .Distinct()
            .ToList();

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var response = await client.PostAsJsonAsync("/analyze/watchlist", new { tickers = normalizedTickers });
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            await TryRecordWatchlistAnalysisHistory(userId.Value, normalizedTickers, content);
            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    private async Task TryRecordAssetAnalysisHistory(Guid userId, List<string> tickers, string payload)
    {
        try
        {
            var title = tickers.Count == 1
                ? $"Ticker Overview: {tickers[0]}"
                : $"Ticker Overview: {tickers[0]} +{tickers.Count - 1}";

            var safePayload = EnsureJson(payload);

            _db.HistoryItems.Add(new HistoryItem
            {
                UserId = userId,
                Kind = HistoryKinds.AssetAnalyze,
                Title = title.Length > 200 ? title[..200] : title,
                Tickers = tickers.ToArray(),
                Payload = safePayload
            });

            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to record asset analysis history");
        }
    }

    private async Task TryRecordWatchlistAnalysisHistory(Guid userId, List<string> tickers, string payload)
    {
        try
        {
            var title = tickers.Count == 1
                ? $"Watchlist Analysis: {tickers[0]}"
                : $"Watchlist Analysis: {tickers[0]} +{tickers.Count - 1}";

            var safePayload = EnsureJson(payload);

            _db.HistoryItems.Add(new HistoryItem
            {
                UserId = userId,
                Kind = HistoryKinds.WatchlistAnalyze,
                Title = title.Length > 200 ? title[..200] : title,
                Tickers = tickers.ToArray(),
                Payload = safePayload
            });

            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to record watchlist analysis history");
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

    [HttpGet("stock/{ticker}/latest")]
    public async Task<IActionResult> GetLatestStockAnalysis(string ticker)
    {
        if (!TickerValidation.IsValid(ticker))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        try
        {
            var userId = User.GetUserGuid();
            if (userId == null)
            {
                return Unauthorized();
            }

            var normalizedTicker = TickerValidation.Normalize(ticker);

            var analysis = await _db.StockAnalysisSnapshots
                .Include(s => s.Watchlist)
                .Where(s => s.TickerSymbol == normalizedTicker && s.Watchlist.UserId == userId)
                .OrderByDescending(s => s.CalculatedAt)
                .FirstOrDefaultAsync();

            if (analysis == null)
            {
                return NotFound(new { error = "No analysis found for this ticker" });
            }

            return Ok(new
            {
                ticker = analysis.TickerSymbol,
                calculatedAt = analysis.CalculatedAt,
                volatility = analysis.Volatility,
                sharpe = analysis.Sharpe,
                var95 = analysis.Var95,
                cvar95 = analysis.CVaR95,
                narrative = analysis.Narrative,
                relatedNewsCount = analysis.RelatedNewsCount,
                sentiment = analysis.Sentiment
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch stock analysis for {Ticker}", ticker);
            return StatusCode(500, new { error = "Internal server error" });
        }
    }

    [HttpGet("watchlist/{id}/daily")]
    public async Task<IActionResult> GetWatchlistDailyInsights(Guid id)
    {
        try
        {
            var userId = User.GetUserGuid();
            if (userId == null)
            {
                return Unauthorized();
            }

            var watchlist = await _db.Watchlists
                .Include(w => w.Assets)
                .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId);

            if (watchlist == null)
            {
                return NotFound(new { error = "Watchlist not found" });
            }

            var tickers = watchlist.Assets.Select(a => a.Symbol).ToList();

            // Get latest stock analyses
            var stockAnalyses = new List<object>();
            foreach (var ticker in tickers)
            {
                var normalizedTicker = TickerValidation.Normalize(ticker);
                var analysis = await _db.StockAnalysisSnapshots
                    .Where(s => s.WatchlistId == id && s.TickerSymbol == normalizedTicker)
                    .OrderByDescending(s => s.CalculatedAt)
                    .FirstOrDefaultAsync();

                if (analysis != null)
                {
                    stockAnalyses.Add(new
                    {
                        ticker = analysis.TickerSymbol,
                        calculatedAt = analysis.CalculatedAt,
                        volatility = analysis.Volatility,
                        sharpe = analysis.Sharpe,
                        var95 = analysis.Var95,
                        cvar95 = analysis.CVaR95,
                        narrative = analysis.Narrative,
                        relatedNewsCount = analysis.RelatedNewsCount,
                        sentiment = analysis.Sentiment
                    });
                }
            }

            // Get latest watchlist snapshot with narrative
            var latestSnapshot = await _db.RiskSnapshots
                .Where(r => r.WatchlistId == id)
                .OrderByDescending(r => r.CalculatedAt)
                .FirstOrDefaultAsync();

            return Ok(new
            {
                watchlistId = id,
                watchlistName = watchlist.Name,
                stockAnalyses,
                watchlistNarrative = latestSnapshot?.Narrative,
                lastUpdated = latestSnapshot?.CalculatedAt
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch daily insights for watchlist {Id}", id);
            return StatusCode(500, new { error = "Internal server error" });
        }
    }
}

public record AssetRequest(List<string> Tickers);

public record WatchlistAnalysisRequest(List<string> Tickers);
