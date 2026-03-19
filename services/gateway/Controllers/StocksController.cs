using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using QuantPlatform.Gateway.Services;

namespace QuantPlatform.Gateway.Controllers;

[ApiController]
[Route("api/stocks")]
[Authorize(Policy = "Authenticated")]
public class StocksController : ControllerBase
{
    private static readonly HashSet<string> ValidChartIntervals = new(StringComparer.OrdinalIgnoreCase)
    {
        "15m", "1h", "1d", "1wk", "1mo"
    };

    private static readonly HashSet<string> ValidChartRanges = new(StringComparer.OrdinalIgnoreCase)
    {
        "1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "10y", "max"
    };

    private static readonly Dictionary<string, TimeSpan> ChartCacheTtl =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["15m"] = TimeSpan.FromMinutes(2),
            ["1h"] = TimeSpan.FromMinutes(5),
            ["1d"] = TimeSpan.FromMinutes(15),
            ["1wk"] = TimeSpan.FromHours(1),
            ["1mo"] = TimeSpan.FromHours(6),
        };

    private static readonly TimeZoneInfo NewYorkTimeZone = ResolveTimeZone();

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _memoryCache;
    private readonly ILogger<StocksController> _logger;

    public StocksController(
        IHttpClientFactory httpClientFactory,
        IMemoryCache memoryCache,
        ILogger<StocksController> logger)
    {
        _httpClientFactory = httpClientFactory;
        _memoryCache = memoryCache;
        _logger = logger;
    }

    [AllowAnonymous]
    [HttpGet("{ticker}/financials")]
    public async Task<IActionResult> GetFinancials(string ticker)
    {
        if (!TickerValidation.IsValid(ticker))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var normalizedTicker = TickerValidation.Normalize(ticker);
            var response = await client.GetAsync($"/financials/{normalizedTicker}");
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    [AllowAnonymous]
    [HttpGet("{ticker}/holders")]
    public async Task<IActionResult> GetHolders(string ticker)
    {
        if (!TickerValidation.IsValid(ticker))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var normalizedTicker = TickerValidation.Normalize(ticker);
            var response = await client.GetAsync($"/holders/{normalizedTicker}");
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    [AllowAnonymous]
    [HttpGet("{ticker}/profile")]
    public async Task<IActionResult> GetProfile(string ticker)
    {
        if (!TickerValidation.IsValid(ticker))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var normalizedTicker = TickerValidation.Normalize(ticker);
            var response = await client.GetAsync($"/profile/{normalizedTicker}");
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            Response.Headers.Append("Cache-Control", "public, max-age=86400");
            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    [AllowAnonymous]
    [HttpGet("{ticker}/chart")]
    public async Task<IActionResult> GetChart(
        string ticker,
        [FromQuery] string? range = "1y",
        [FromQuery] string? interval = "1d")
    {
        if (!TickerValidation.IsValid(ticker))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        var normalizedRange = string.IsNullOrWhiteSpace(range)
            ? "1y"
            : range.Trim().ToLowerInvariant();
        var normalizedInterval = string.IsNullOrWhiteSpace(interval)
            ? "1d"
            : interval.Trim().ToLowerInvariant();

        if (!ValidChartRanges.Contains(normalizedRange))
        {
            return BadRequest(new { error = $"Invalid range: {normalizedRange}" });
        }

        if (!ValidChartIntervals.Contains(normalizedInterval))
        {
            return BadRequest(new { error = $"Invalid interval: {normalizedInterval}" });
        }

        var normalizedTicker = TickerValidation.Normalize(ticker);
        var cacheKey = $"chart:{normalizedTicker}:{normalizedRange}:{normalizedInterval}";

        if (_memoryCache.TryGetValue<ChartPayload>(cacheKey, out var cachedPayload) &&
            cachedPayload is not null)
        {
            Response.Headers.Append("X-Cache", "HIT");
            return Ok(cachedPayload);
        }

        try
        {
            var client = _httpClientFactory.CreateClient();
            var yahooUrl =
                $"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(normalizedTicker)}" +
                $"?range={normalizedRange}&interval={normalizedInterval}&includePrePost=false";

            using var request = new HttpRequestMessage(HttpMethod.Get, yahooUrl);
            request.Headers.UserAgent.ParseAdd("Mozilla/5.0 (compatible; QuantPlatform/1.0)");

            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new
                {
                    error = "Failed to fetch chart data",
                    details = $"Yahoo Finance returned {(int)response.StatusCode}"
                });
            }

            await using var stream = await response.Content.ReadAsStreamAsync();
            var yahooPayload = await JsonSerializer.DeserializeAsync<YahooChartResponse>(
                stream,
                new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                });

            var result =
                yahooPayload?.Chart?.Result != null && yahooPayload.Chart.Result.Count > 0
                    ? yahooPayload.Chart.Result[0]
                    : null;

            var timestamps = result?.Timestamp ?? new List<long>();
            var quote =
                result?.Indicators?.Quote != null && result.Indicators.Quote.Count > 0
                    ? result.Indicators.Quote[0]
                    : null;

            var dataPoints = new List<ChartDataPoint>();
            if (quote is not null && timestamps.Count > 0)
            {
                var opens = quote.Open ?? new List<decimal?>();
                var highs = quote.High ?? new List<decimal?>();
                var lows = quote.Low ?? new List<decimal?>();
                var closes = quote.Close ?? new List<decimal?>();
                var volumes = quote.Volume ?? new List<long?>();

                for (var i = 0; i < timestamps.Count; i++)
                {
                    var open = i < opens.Count ? opens[i] : null;
                    var high = i < highs.Count ? highs[i] : null;
                    var low = i < lows.Count ? lows[i] : null;
                    var close = i < closes.Count ? closes[i] : null;
                    var volume = i < volumes.Count ? volumes[i] : null;

                    if (open is null || high is null || low is null || close is null)
                    {
                        continue;
                    }

                    dataPoints.Add(new ChartDataPoint(
                        date: FormatChartDate(timestamps[i], normalizedInterval, normalizedRange),
                        open: Math.Round((double)open.Value, 2),
                        high: Math.Round((double)high.Value, 2),
                        low: Math.Round((double)low.Value, 2),
                        close: Math.Round((double)close.Value, 2),
                        volume: volume ?? 0
                    ));
                }
            }

            var payload = new ChartPayload(
                ticker: normalizedTicker,
                interval: normalizedInterval,
                range: normalizedRange,
                data: dataPoints
            );

            var ttl = ChartCacheTtl.TryGetValue(normalizedInterval, out var configuredTtl)
                ? configuredTtl
                : TimeSpan.FromMinutes(15);
            _memoryCache.Set(cacheKey, payload, ttl);

            Response.Headers.Append("X-Cache", "MISS");
            Response.Headers.Append(
                "Cache-Control",
                $"public, max-age={(int)ttl.TotalSeconds}, stale-while-revalidate=60");

            return Ok(payload);
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"Chart provider connection failed: {ex.Message}" });
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Invalid chart payload for {Ticker}", normalizedTicker);
            return StatusCode(502, new { error = "Failed to parse chart data" });
        }
    }

    [AllowAnonymous]
    [HttpGet("{ticker}/earnings")]
    public async Task<IActionResult> GetEarnings(string ticker)
    {
        if (!TickerValidation.IsValid(ticker))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var normalizedTicker = TickerValidation.Normalize(ticker);
            var response = await client.GetAsync($"/earnings/{normalizedTicker}");
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    [AllowAnonymous]
    [HttpGet("{ticker}/filings")]
    public async Task<IActionResult> GetFilings(string ticker, [FromQuery] string? types = null, [FromQuery] bool analyze = true)
    {
        if (!TickerValidation.IsValid(ticker))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        var filingTypes = string.IsNullOrWhiteSpace(types)
            ? new[] { "10-K", "10-Q", "8-K" }
            : types.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var endpoint = analyze ? "/filings/analyze" : "/filings";
            var response = await client.PostAsJsonAsync(endpoint, new
            {
                tickers = new[] { TickerValidation.Normalize(ticker) },
                filing_types = filingTypes
            });
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    [AllowAnonymous]
    [HttpGet("{ticker}/sentiment")]
    public async Task<IActionResult> GetSentiment(string ticker)
    {
        if (!TickerValidation.IsValid(ticker))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var response = await client.PostAsJsonAsync("/sentiment/compare", new
            {
                tickers = new[] { TickerValidation.Normalize(ticker) }
            });
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    [AllowAnonymous]
    [HttpGet("{ticker}/news")]
    public async Task<IActionResult> GetNews(string ticker, [FromQuery] int limit = 10)
    {
        if (!TickerValidation.IsValid(ticker))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var normalizedTicker = TickerValidation.Normalize(ticker);
            var response = await client.GetAsync($"/news/{normalizedTicker}?limit={limit}");
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            // Add cache control headers (24 hours for stock news)
            Response.Headers.Append("Cache-Control", "public, max-age=86400");
            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    [AllowAnonymous]
    [HttpGet("news/market")]
    public async Task<IActionResult> GetMarketNews([FromQuery] int limit = 20)
    {
        try
        {
            var client = _httpClientFactory.CreateClient("AIEngine");
            var response = await client.GetAsync($"/news/market?limit={limit}");
            var content = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                return StatusCode(502, new { error = "AI Engine unavailable", details = content });
            }

            // Add cache control headers (1 hour for market news)
            Response.Headers.Append("Cache-Control", "public, max-age=3600");
            return Content(content, "application/json");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(503, new { error = $"AI Engine connection failed: {ex.Message}" });
        }
    }

    private static TimeZoneInfo ResolveTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time");
        }
    }

    private static string FormatChartDate(long unixSeconds, string interval, string range)
    {
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(unixSeconds), NewYorkTimeZone);

        if (interval.Equals("15m", StringComparison.OrdinalIgnoreCase))
        {
            var time = local.ToString("HH:mm", CultureInfo.InvariantCulture);
            if (range.Equals("1d", StringComparison.OrdinalIgnoreCase))
            {
                return time;
            }

            return $"{local.ToString("MMM d", CultureInfo.InvariantCulture)} {time}";
        }

        if (interval.Equals("1h", StringComparison.OrdinalIgnoreCase))
        {
            return local.ToString("MMM d HH:mm", CultureInfo.InvariantCulture);
        }

        if (interval.Equals("1mo", StringComparison.OrdinalIgnoreCase))
        {
            return local.ToString("MMM yyyy", CultureInfo.InvariantCulture);
        }

        return local.ToString("MMM d", CultureInfo.InvariantCulture);
    }

    private sealed record ChartDataPoint(
        string date,
        double open,
        double high,
        double low,
        double close,
        long volume);

    private sealed record ChartPayload(
        string ticker,
        string interval,
        string range,
        IReadOnlyList<ChartDataPoint> data);

    private sealed class YahooChartResponse
    {
        public YahooChartEnvelope? Chart { get; set; }
    }

    private sealed class YahooChartEnvelope
    {
        public List<YahooChartResult>? Result { get; set; }
    }

    private sealed class YahooChartResult
    {
        public List<long>? Timestamp { get; set; }
        public YahooChartIndicators? Indicators { get; set; }
    }

    private sealed class YahooChartIndicators
    {
        public List<YahooChartQuote>? Quote { get; set; }
    }

    private sealed class YahooChartQuote
    {
        [JsonPropertyName("open")]
        public List<decimal?>? Open { get; set; }

        [JsonPropertyName("high")]
        public List<decimal?>? High { get; set; }

        [JsonPropertyName("low")]
        public List<decimal?>? Low { get; set; }

        [JsonPropertyName("close")]
        public List<decimal?>? Close { get; set; }

        [JsonPropertyName("volume")]
        public List<long?>? Volume { get; set; }
    }
}
