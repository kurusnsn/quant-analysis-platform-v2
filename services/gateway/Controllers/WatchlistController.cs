using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;
using QuantPlatform.Gateway.Services;

namespace QuantPlatform.Gateway.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = "Authenticated")]
public class WatchlistsController : ControllerBase
{
    private const int MinPromptLength = 2;
    private const int MaxPromptLength = 1200;

    private readonly QuantPlatformDbContext _db;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IStorageService _storage;

    public WatchlistsController(QuantPlatformDbContext db, IHttpClientFactory httpClientFactory, IStorageService storage)
    {
        _db = db;
        _httpClientFactory = httpClientFactory;
        _storage = storage;
    }

    [HttpGet]
    public async Task<IActionResult> GetWatchlists()
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var watchlists = await _db.Watchlists
            .Include(w => w.Assets)
            .Where(w => w.UserId == userId)
            .OrderByDescending(w => w.CreatedAt)
            .ToListAsync();
        return Ok(watchlists);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetWatchlist(Guid id)
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var watchlist = await _db.Watchlists
            .Include(w => w.Assets)
            .Include(w => w.RiskSnapshots.OrderByDescending(r => r.CalculatedAt).Take(1))
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId);
            
        if (watchlist == null) return NotFound();
        return Ok(watchlist);
    }

    [HttpPost]
    public async Task<IActionResult> CreateWatchlist([FromBody] CreateWatchlistRequest request)
    {
        if (string.IsNullOrEmpty(request.Name)) 
            return BadRequest("Name is required");

        if (request.Tickers != null && request.Tickers.Any(t => !TickerValidation.IsValid(t)))
        {
            var invalid = request.Tickers.First(t => !TickerValidation.IsValid(t));
            return BadRequest(new { error = "Invalid ticker format", ticker = invalid });
        }

        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        await EnsureUserExistsAsync(userId.Value);

        var watchlist = new Watchlist
        {
            Name = request.Name,
            RiskLevel = "Unknown",
            UserId = userId
        };

        var normalizedSymbols = new List<string>();
        foreach (var symbol in request.Tickers ?? new List<string>())
        {
            var normalized = TickerValidation.Normalize(symbol);
            normalizedSymbols.Add(normalized);
            watchlist.Assets.Add(new WatchlistAsset { Symbol = normalized });
        }

        // Update popularity counts for initial tickers
        if (normalizedSymbols.Count > 0)
        {
            await UpdatePopularityCounts(normalizedSymbols, decrement: false);
        }

        _db.Watchlists.Add(watchlist);
        await _db.SaveChangesAsync();
        
        return CreatedAtAction(nameof(GetWatchlist), new { id = watchlist.Id }, watchlist);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteWatchlist(Guid id)
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var watchlist = await _db.Watchlists
            .Include(w => w.Assets)
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId);
        if (watchlist == null) return NotFound();

        // Decrement popularity for all assets being removed with the watchlist
        var symbolsToDecrement = watchlist.Assets.Select(a => a.Symbol).ToList();
        await UpdatePopularityCounts(symbolsToDecrement, decrement: true);
        
        _db.Watchlists.Remove(watchlist);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPatch("{id}")]
    public async Task<IActionResult> UpdateWatchlistTickers(Guid id, [FromBody] UpdateWatchlistRequest request)
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var watchlist = await _db.Watchlists
            .Include(w => w.Assets)
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId);
        if (watchlist == null) return NotFound();

        var newSymbols = (request.Assets ?? new List<UpdateAssetDto>())
            .Where(a => !string.IsNullOrWhiteSpace(a.Symbol) && TickerValidation.IsValid(a.Symbol))
            .Select(a => TickerValidation.Normalize(a.Symbol))
            .Distinct()
            .ToList();

        var existingSymbols = watchlist.Assets.Select(a => a.Symbol).ToHashSet();
        var symbolsToAdd = newSymbols.Except(existingSymbols).ToList();
        var symbolsToRemove = existingSymbols.Except(newSymbols).ToList();

        // Update popularity counts
        if (symbolsToAdd.Count > 0)
        {
            await UpdatePopularityCounts(symbolsToAdd, decrement: false);
        }
        if (symbolsToRemove.Count > 0)
        {
            await UpdatePopularityCounts(symbolsToRemove, decrement: true);
        }

        // Remove old assets
        var assetsToRemove = watchlist.Assets.Where(a => symbolsToRemove.Contains(a.Symbol)).ToList();
        foreach (var asset in assetsToRemove)
        {
            watchlist.Assets.Remove(asset);
        }

        // Add new assets
        foreach (var symbol in symbolsToAdd)
        {
            watchlist.Assets.Add(new WatchlistAsset { Symbol = symbol });
        }

        watchlist.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(watchlist);
    }

    private async Task UpdatePopularityCounts(IEnumerable<string> symbols, bool decrement)
    {
        foreach (var symbol in symbols)
        {
            var popularity = await _db.StockPopularities.FindAsync(symbol);
            if (popularity == null)
            {
                if (!decrement)
                {
                    _db.StockPopularities.Add(new StockPopularity
                    {
                        Symbol = symbol,
                        WatchlistCount = 1,
                        UpdatedAt = DateTime.UtcNow
                    });
                }
            }
            else
            {
                if (decrement)
                {
                    popularity.WatchlistCount = Math.Max(0, popularity.WatchlistCount - 1);
                }
                else
                {
                    popularity.WatchlistCount++;
                }
                popularity.UpdatedAt = DateTime.UtcNow;
            }
        }
    }

    [HttpPost("{id}/analyze")]
    public async Task<IActionResult> AnalyzeWatchlist(Guid id)
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var watchlist = await _db.Watchlists
            .Include(w => w.Assets)
            .FirstOrDefaultAsync(w => w.Id == id && w.UserId == userId);
            
        if (watchlist == null) return NotFound();

        if (watchlist.Assets.Any(a => !TickerValidation.IsValid(a.Symbol)))
        {
            return BadRequest(new { error = "Watchlist contains invalid ticker symbols." });
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var tickers = watchlist.Assets.Select(a => a.Symbol).ToList();
            
            var response = await client.PostAsJsonAsync("/analyze/watchlist", new { tickers });
            
            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable" });
            }

            var result = await response.Content.ReadFromJsonAsync<AnalysisResult>();

            if (result != null)
            {
                if (!IsValidAnalysisResult(result))
                {
                    return StatusCode(502, new { error = "AI Engine returned invalid analysis payload." });
                }

                var payloadJson = System.Text.Json.JsonSerializer.Serialize(result);

                // Generate narrative using AI
                string? narrative = null;
                try
                {
                    var narrativeResponse = await client.PostAsJsonAsync("/narrative", new { tickers });
                    if (narrativeResponse.IsSuccessStatusCode)
                    {
                        var narrativeResult = await narrativeResponse.Content.ReadFromJsonAsync<NarrativeResult>();
                        narrative = TrimNarrative(narrativeResult?.Narrative);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"⚠️ Narrative generation failed: {ex.Message}");
                    // Continue without narrative
                }

                // Save full report to S3
                string? s3Key = null;
                try
                {
                    s3Key = await _storage.SaveReportAsync($"{watchlist.Name}-report", payloadJson);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"⚠️ S3 Save Failed: {ex.Message}");
                    // Continue anyway, we have the summary in DB
                }

                // Store snapshot
                var snapshot = new RiskSnapshot
                {
                    WatchlistId = watchlist.Id,
                    Volatility = result.Volatility,
                    Var95 = result.Var95,
                    CVaR95 = result.CVaR95,
                    LossProbability30d = result.LossProbability30d,
                    Regime = result.Regime,
                    RawPayload = payloadJson,
                    ReportS3Key = s3Key,
                    Narrative = narrative
                };
                
	                _db.RiskSnapshots.Add(snapshot);

                    // Record history with a snapshot of tickers at analysis time.
                    var historyPayload = new
                    {
                        watchlistId = watchlist.Id,
                        watchlistName = watchlist.Name,
                        tickers,
                        snapshotId = snapshot.Id,
                        calculatedAt = snapshot.CalculatedAt,
                        analysis = result,
                        narrative,
                        reportS3Key = s3Key
                    };

                    _db.HistoryItems.Add(new HistoryItem
                    {
                        UserId = userId.Value,
                        Kind = HistoryKinds.WatchlistAnalyze,
                        Title = watchlist.Name,
                        WatchlistId = watchlist.Id,
                        WatchlistName = watchlist.Name,
                        Tickers = tickers.ToArray(),
                        Payload = JsonSerializer.Serialize(historyPayload)
                    });
	                
	                // Update watchlist risk level
	                watchlist.RiskLevel = result.Regime;
	                watchlist.UpdatedAt = DateTime.UtcNow;
                
                await _db.SaveChangesAsync();
            }
            
            return Ok(result);
        }
        catch (HttpRequestException)
        {
            return StatusCode(503, new { error = "AI Engine connection failed" });
        }
    }

    [HttpGet("reports/{snapshotId}")]
    public async Task<IActionResult> GetReport(Guid snapshotId)
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var snapshot = await _db.RiskSnapshots
            .Include(r => r.Watchlist)
            .FirstOrDefaultAsync(r => r.Id == snapshotId && r.Watchlist.UserId == userId);
        if (snapshot == null) return NotFound("Snapshot not found");
        if (string.IsNullOrEmpty(snapshot.ReportS3Key)) return NotFound("No S3 report available for this snapshot");

        try
        {
            var content = await _storage.GetReportAsync(snapshot.ReportS3Key);
            return Content(content, "application/json");
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { error = $"Failed to retrieve report from S3: {ex.Message}" });
        }
    }

    [EnableRateLimiting("ai-generate")]
    [HttpPost("generate")]
    public async Task<IActionResult> GenerateWatchlist([FromBody] GenerateRequest request)
    {
        var normalizedPrompt = NormalizePrompt(request.Prompt);
        if (string.IsNullOrWhiteSpace(normalizedPrompt))
        {
            return BadRequest(new { error = "Prompt is required." });
        }

        if (normalizedPrompt.Length < MinPromptLength)
        {
            return BadRequest(new { error = "Prompt too short" });
        }

        if (normalizedPrompt.Length > MaxPromptLength)
        {
            return BadRequest(new { error = "Prompt too long" });
        }

        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var response = await client.PostAsJsonAsync(
                "/generate/watchlist",
                new
                {
                    prompt = normalizedPrompt,
                    deepResearch = request.DeepResearch,
                    userId = userId.Value.ToString()
                }
            );

            if (!response.IsSuccessStatusCode)
            {
                var error = await response.Content.ReadAsStringAsync();
                return StatusCode(502, new { error = $"AI Engine error: {error}" });
            }

            var result = await response.Content.ReadFromJsonAsync<GenerateWatchlistResult>();
            
            if (result?.Tickers != null && result.Tickers.Count > 0)
            {
                var validTickers = result.Tickers
                    .Where(t => !string.IsNullOrWhiteSpace(t.Symbol) && TickerValidation.IsValid(t.Symbol))
                    .ToList();

                if (validTickers.Count == 0)
                {
                    return StatusCode(502, new { error = "AI Engine returned invalid ticker symbols." });
                }

                await EnsureUserExistsAsync(userId.Value);

                // Auto-save the generated watchlist
                var watchlist = new Watchlist
                {
                    Name = result.WatchlistName ?? "Generated Strategy",
                    RiskLevel = result.Meta?.Regime?.CurrentRegime ?? "Unknown",
                    UserId = userId
                };

                foreach (var ticker in validTickers)
                {
                    watchlist.Assets.Add(new WatchlistAsset 
                    { 
                        Symbol = TickerValidation.Normalize(ticker.Symbol),
                    });
                }

                var responsePayload = new
                {
                    watchlistId = watchlist.Id,
                    watchlistName = result.WatchlistName,
                    narrative = result.Narrative,
                    reasoning = result.Reasoning,
                    model = result.Model,
                    deepResearch = result.DeepResearch,
                    citations = result.Citations,
                    tickerExplanations = result.TickerExplanations,
                    tickers = validTickers,
                    meta = result.Meta
                };

                var payloadJson = JsonSerializer.Serialize(responsePayload);

                // Update popularity counts for newly generated tickers
                var symbolsToTrack = watchlist.Assets.Select(a => a.Symbol).ToList();
                if (symbolsToTrack.Count > 0)
                {
                    await UpdatePopularityCounts(symbolsToTrack, decrement: false);
                }

                _db.Watchlists.Add(watchlist);
                _db.HistoryItems.Add(new HistoryItem
                {
                    UserId = userId.Value,
                    Kind = HistoryKinds.WatchlistGenerate,
                    Title = watchlist.Name,
                    Prompt = normalizedPrompt.Length <= 5000 ? normalizedPrompt : normalizedPrompt[..5000],
                    WatchlistId = watchlist.Id,
                    WatchlistName = watchlist.Name,
                    Tickers = watchlist.Assets.Select(a => a.Symbol).ToArray(),
                    Payload = payloadJson
                });

                await _db.SaveChangesAsync();

                // Include the watchlist ID in response
                return Ok(responsePayload);
            }

            return Ok(result);
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    private async Task EnsureUserExistsAsync(Guid userId)
    {
        // Watchlists have a FK to Users; dev auth can authenticate a user that doesn't exist in the DB yet.
        // Ensure the row exists before we insert watchlists/snapshots that reference it.
        var existing = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (existing != null)
        {
            var emailClaim = User.GetEmail();
            if (string.IsNullOrWhiteSpace(existing.Email) && !string.IsNullOrWhiteSpace(emailClaim))
            {
                existing.Email = emailClaim;
            }

            return;
        }

        var email = User.GetEmail();
        if (string.IsNullOrWhiteSpace(email))
        {
            email = $"user-{userId}@quant-platform.local";
        }

        // Email is unique; if it collides (dev/testing), fall back to a deterministic unique value.
        var emailTaken = await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Email == email && u.Id != userId);
        if (emailTaken)
        {
            email = $"user-{userId}@quant-platform.local";
        }

        if (email.Length > 100)
        {
            email = $"user-{userId:N}@quant-platform.local";
            if (email.Length > 100)
            {
                email = email[..100];
            }
        }

        _db.Users.Add(new User
        {
            Id = userId,
            Email = email,
            DisplayName = string.Empty
        });
    }

    private const int MaxNarrativeLength = 2000;

    private static string? TrimNarrative(string? narrative)
    {
        if (string.IsNullOrWhiteSpace(narrative))
        {
            return narrative;
        }

        return narrative.Length <= MaxNarrativeLength
            ? narrative
            : narrative[..MaxNarrativeLength];
    }

    private static bool IsValidAnalysisResult(AnalysisResult result)
    {
        if (!IsFinite(result.Volatility) ||
            !IsFinite(result.Var95) ||
            !IsFinite(result.CVaR95) ||
            !IsFinite(result.LossProbability30d))
        {
            return false;
        }

        return !string.IsNullOrWhiteSpace(result.Regime) && result.Regime.Length <= 50;
    }

    private static bool IsFinite(double value)
    {
        return !double.IsNaN(value) && !double.IsInfinity(value);
    }

    private static string NormalizePrompt(string? prompt)
    {
        if (string.IsNullOrWhiteSpace(prompt))
        {
            return string.Empty;
        }

        var sanitized = new string(
            prompt
                .Where(ch => !char.IsControl(ch) || ch is '\n' or '\r' or '\t')
                .ToArray());

        return sanitized.Trim();
    }
}

public record CreateWatchlistRequest(string Name, List<string>? Tickers);

public record UpdateWatchlistRequest(List<UpdateAssetDto>? Assets);

public record UpdateAssetDto(string Symbol);

public record GenerateRequest(string Prompt, bool DeepResearch = false);

public record GenerateWatchlistResult(
    string? WatchlistName,
    string? Narrative,
    string? Reasoning,
    string? Model,
    bool? DeepResearch,
    List<GeneratedCitation>? Citations,
    List<GeneratedTickerExplanation>? TickerExplanations,
    List<GeneratedTicker>? Tickers,
    GenerateMeta? Meta
);

public record GeneratedTickerExplanation(
    string? Symbol,
    string? Rationale,
    GeneratedFinancialHighlights? FinancialHighlights,
    List<GeneratedFiling>? Filings
);

public record GeneratedFinancialHighlights(
    double? MarketCap,
    double? TotalRevenue,
    double? NetIncome,
    double? TotalDebt,
    double? EpsDiluted
);

public record GeneratedFiling(
    string? Form,
    string? FilingDate,
    string? Description,
    string? Url
);

public record GeneratedCitation(
    string? Source,
    string? Title,
    string? Url,
    string? Chunk
);

public record GeneratedTicker(
    string Symbol,
    string? Name,
    string? Sector,
    double? Price,
    int RiskScore,
    double? Volatility_30d,
    double? Sharpe_ratio,
    double? Var_95,
    double? Cvar_95
);

public record GenerateMeta(
    GenerateIntent? Intent,
    RegimeInfo? Regime,
    SimulationInfo? Simulation,
    GenerateConstraints? Constraints,
    GenerateRagMeta? Rag
);

public record GenerateIntent(
    string? Sector,
    string? Risk_level,
    string? Theme
);

public record RegimeInfo(
    string? CurrentRegime,
    double? PersistenceProbability
);

public record SimulationInfo(
    double? Loss_probability_30d,
    double? Expected_return
);

public record GenerateRagMeta(
    bool? Enabled,
    int? Context_hits
);

public record GenerateConstraints(
    double? Min_market_cap,
    int? Min_volume,
    int? Max_tickers
);

public record AnalysisResult(
    double Volatility,
    double Var95,
    double CVaR95,
    double LossProbability30d,
    string Regime,
    List<string>? Tickers
);

public record NarrativeResult(
    string? Narrative,
    object? RiskData,
    bool? LlmEnabled
);
