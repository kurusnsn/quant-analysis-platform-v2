using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Json;
using System.Text.Json;

namespace QuantPlatform.Gateway.Jobs;

public class DailyRiskUpdateJob
{
    private readonly QuantPlatformDbContext _db;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<DailyRiskUpdateJob> _logger;

    public DailyRiskUpdateJob(QuantPlatformDbContext db, IHttpClientFactory httpClientFactory, ILogger<DailyRiskUpdateJob> logger)
    {
        _db = db;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task ExecuteAsync()
    {
        _logger.LogInformation("🚀 Starting Daily Risk Update Job at {Time}", DateTime.UtcNow);

        var watchlists = await _db.Watchlists.Include(w => w.Assets).ToListAsync();

        var client = _httpClientFactory.CreateClient("AIEngine");
        int successCount = 0;
        int failureCount = 0;

        foreach (var watchlist in watchlists)
        {
            try
            {
                var tickers = watchlist.Assets.Select(a => a.Symbol).ToList();
                if (!tickers.Any()) continue;

                _logger.LogInformation("Processing watchlist with {Count} stocks", tickers.Count);

                // ============================================
                // STEP 1: Per-Stock Analysis
                // ============================================
                var stockAnalyses = new List<StockAnalysisSnapshot>();

                foreach (var ticker in tickers)
                {
                    try
                    {
                        _logger.LogInformation("  → Analyzing {Ticker}", ticker);

                        // Analyze single asset
                        var analysisResponse = await client.PostAsJsonAsync("/analyze/asset", new { tickers = new[] { ticker } });
                        if (!analysisResponse.IsSuccessStatusCode) continue;

                        var analysis = await analysisResponse.Content.ReadFromJsonAsync<AssetAnalysisResult>();
                        if (analysis == null || !IsValidAssetAnalysis(analysis)) continue;

                        // Get news for sentiment
                        var newsResponse = await client.GetAsync($"/news/{ticker}?limit=5");
                        var newsResult = newsResponse.IsSuccessStatusCode
                            ? await newsResponse.Content.ReadFromJsonAsync<NewsResult>()
                            : null;
                        var newsHeadlines = newsResult?.News?.Select(n => n.Title).ToList() ?? new List<string>();
                        var newsCount = newsHeadlines.Count;

                        // Generate per-stock narrative
                        var narrativeResponse = await client.PostAsJsonAsync("/narrative/stock", new
                        {
                            ticker,
                            analysis = new
                            {
                                volatility = analysis.Volatility,
                                sharpe = analysis.SharpeRatio,
                                var_95 = analysis.Var95,
                                cvar_95 = analysis.CVaR95
                            },
                            news_headlines = newsHeadlines
                        });

                        string? narrative = null;
                        if (narrativeResponse.IsSuccessStatusCode)
                        {
                            var narrativeResult = await narrativeResponse.Content.ReadFromJsonAsync<StockNarrativeResult>();
                            narrative = TrimNarrative(narrativeResult?.Narrative);
                        }

                        // Determine sentiment (simple heuristic)
                        var sentiment = DetermineSentiment(newsHeadlines);

                        // Save snapshot
                        var snapshot = new StockAnalysisSnapshot
                        {
                            WatchlistId = watchlist.Id,
                            TickerSymbol = ticker,
                            Volatility = analysis.Volatility,
                            Sharpe = analysis.SharpeRatio,
                            Var95 = analysis.Var95,
                            CVaR95 = analysis.CVaR95,
                            Narrative = narrative,
                            RelatedNewsCount = newsCount,
                            Sentiment = sentiment
                        };

                        stockAnalyses.Add(snapshot);
                        _db.StockAnalysisSnapshots.Add(snapshot);

                        _logger.LogInformation("  ✅ {Ticker}: Vol={Vol:P2}, Sharpe={Sharpe:F2}, News={News}",
                            ticker, analysis.Volatility, analysis.SharpeRatio, newsCount);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "  ⚠️ Failed to analyze {Ticker}", ticker);
                    }
                }

                await _db.SaveChangesAsync();

                // ============================================
                // STEP 2: Watchlist-Level Analysis & Synthesis
                // ============================================
                var watchlistResponse = await client.PostAsJsonAsync("/analyze/watchlist", new { tickers });

                if (watchlistResponse.IsSuccessStatusCode)
                {
                    var watchlistAnalysis = await watchlistResponse.Content.ReadFromJsonAsync<WatchlistAnalysisResult>();

                    // Generate watchlist narrative
                    string? watchlistNarrative = null;
                    try
                    {
                        var narrativeResponse = await client.PostAsJsonAsync("/narrative", new { tickers });
                        if (narrativeResponse.IsSuccessStatusCode)
                        {
                            var narrativeResult = await narrativeResponse.Content.ReadFromJsonAsync<NarrativeResult>();
                            watchlistNarrative = narrativeResult?.Narrative;
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to generate watchlist narrative");
                    }

                    // Save watchlist snapshot
                    if (watchlistAnalysis != null && IsValidWatchlistAnalysis(watchlistAnalysis))
                    {
                        var snapshot = new RiskSnapshot
                        {
                            WatchlistId = watchlist.Id,
                            Volatility = watchlistAnalysis.Volatility,
                            Var95 = watchlistAnalysis.Var95,
                            CVaR95 = watchlistAnalysis.CVaR95,
                            LossProbability30d = watchlistAnalysis.LossProbability30d,
                            Regime = watchlistAnalysis.Regime,
                            Narrative = TrimNarrative(watchlistNarrative),
                            RawPayload = JsonSerializer.Serialize(watchlistAnalysis)
                        };

                        _db.RiskSnapshots.Add(snapshot);

                        // Persist daily watchlist insights in user history so the UI can display them later.
                        // This avoids writing history entries on read (page views).
                        if (watchlist.UserId.HasValue)
                        {
                            var historyPayload = new
                            {
                                watchlistId = watchlist.Id,
                                watchlistName = watchlist.Name,
                                tickers,
                                snapshotId = snapshot.Id,
                                calculatedAt = snapshot.CalculatedAt,
                                analysis = watchlistAnalysis,
                                narrative = snapshot.Narrative,
                                stockAnalyses = stockAnalyses.Select(s => new
                                {
                                    ticker = s.TickerSymbol,
                                    calculatedAt = s.CalculatedAt,
                                    volatility = s.Volatility,
                                    sharpe = s.Sharpe,
                                    var95 = s.Var95,
                                    cvar95 = s.CVaR95,
                                    narrative = s.Narrative,
                                    relatedNewsCount = s.RelatedNewsCount,
                                    sentiment = s.Sentiment
                                })
                            };

                            _db.HistoryItems.Add(new HistoryItem
                            {
                                UserId = watchlist.UserId.Value,
                                Kind = HistoryKinds.WatchlistAnalyze,
                                Title = watchlist.Name,
                                WatchlistId = watchlist.Id,
                                WatchlistName = watchlist.Name,
                                Tickers = tickers.ToArray(),
                                Payload = JsonSerializer.Serialize(historyPayload)
                            });
                        }

                        await _db.SaveChangesAsync();

                        _logger.LogInformation("✅ Successfully updated risk ({Stocks} stocks analyzed)", stockAnalyses.Count);
                        successCount++;
                    }
                    else
                    {
                        _logger.LogWarning("⚠️ Invalid watchlist analysis payload returned");
                        failureCount++;
                    }
                }
                else
                {
                    _logger.LogWarning("⚠️ Failed to update watchlist risk: {Status}",
                        watchlistResponse.StatusCode);
                    failureCount++;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Error processing watchlist");
                failureCount++;
            }
        }

        _logger.LogInformation("🏁 Daily Risk Update Job finished. Success: {Success}, Failures: {Failures}",
            successCount, failureCount);
    }

    private static string DetermineSentiment(List<string> headlines)
    {
        if (headlines.Count == 0) return "neutral";

        var allText = string.Join(" ", headlines).ToLower();
        var positiveWords = new[] { "growth", "beat", "strong", "surge", "gain", "profit", "rise", "up", "high" };
        var negativeWords = new[] { "loss", "fall", "drop", "decline", "weak", "miss", "down", "low", "cut" };

        int positiveCount = positiveWords.Count(word => allText.Contains(word));
        int negativeCount = negativeWords.Count(word => allText.Contains(word));

        if (positiveCount > negativeCount) return "positive";
        if (negativeCount > positiveCount) return "negative";
        return "neutral";
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

    private static bool IsValidAssetAnalysis(AssetAnalysisResult analysis)
    {
        return IsFinite(analysis.Volatility)
            && IsFinite(analysis.SharpeRatio)
            && IsFinite(analysis.Var95)
            && IsFinite(analysis.CVaR95)
            && !string.IsNullOrWhiteSpace(analysis.Regime)
            && analysis.Regime.Length <= 50;
    }

    private static bool IsValidWatchlistAnalysis(WatchlistAnalysisResult analysis)
    {
        return IsFinite(analysis.Volatility)
            && IsFinite(analysis.Var95)
            && IsFinite(analysis.CVaR95)
            && IsFinite(analysis.LossProbability30d)
            && !string.IsNullOrWhiteSpace(analysis.Regime)
            && analysis.Regime.Length <= 50;
    }

    private static bool IsFinite(double value)
    {
        return !double.IsNaN(value) && !double.IsInfinity(value);
    }
}

// Response models
internal record AssetAnalysisResult(
    string Ticker,
    double Volatility,
    double SharpeRatio,
    double Var95,
    double CVaR95,
    string Regime
);

internal record WatchlistAnalysisResult(
    double Volatility,
    double Var95,
    double CVaR95,
    double LossProbability30d,
    string Regime
);

internal record NewsResult(
    string Ticker,
    List<NewsArticle> News,
    int Count
);

internal record NewsArticle(
    string Title,
    string Publisher,
    string Link
);

internal record StockNarrativeResult(
    string Ticker,
    string Narrative,
    bool LlmEnabled
);

internal record NarrativeResult(
    string Narrative,
    object? RiskData,
    bool LlmEnabled
);
