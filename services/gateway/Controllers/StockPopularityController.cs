using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;
using QuantPlatform.Gateway.Services;

namespace QuantPlatform.Gateway.Controllers;

[ApiController]
[Route("api/stockpopularity")]
public class StockPopularityController : ControllerBase
{
    private readonly QuantPlatformDbContext _db;

    public StockPopularityController(QuantPlatformDbContext db)
    {
        _db = db;
    }

    /// <summary>
    /// Get popularity for a single symbol.
    /// </summary>
    [HttpGet("{symbol}")]
    public async Task<IActionResult> GetSymbolPopularity(string symbol)
    {
        if (!TickerValidation.IsValid(symbol))
        {
            return BadRequest(new { error = "Invalid ticker format" });
        }

        var normalized = TickerValidation.Normalize(symbol);
        var popularity = await _db.StockPopularities
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Symbol == normalized);

        if (popularity == null)
        {
            return Ok(new StockPopularityDto(normalized, 0, null));
        }

        return Ok(new StockPopularityDto(popularity.Symbol, popularity.WatchlistCount, popularity.UpdatedAt));
    }

    /// <summary>
    /// Get popularity for multiple symbols (batch query).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetBatchPopularity([FromQuery] string? symbols)
    {
        if (string.IsNullOrWhiteSpace(symbols))
        {
            return BadRequest(new { error = "symbols query parameter is required" });
        }

        var symbolList = symbols
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(s => TickerValidation.IsValid(s))
            .Select(s => TickerValidation.Normalize(s))
            .Distinct()
            .Take(50) // Limit to prevent abuse
            .ToList();

        if (symbolList.Count == 0)
        {
            return BadRequest(new { error = "No valid symbols provided" });
        }

        var popularities = await _db.StockPopularities
            .AsNoTracking()
            .Where(s => symbolList.Contains(s.Symbol))
            .ToDictionaryAsync(s => s.Symbol);

        var result = symbolList.Select(symbol =>
        {
            if (popularities.TryGetValue(symbol, out var pop))
            {
                return new StockPopularityDto(pop.Symbol, pop.WatchlistCount, pop.UpdatedAt);
            }
            return new StockPopularityDto(symbol, 0, null);
        }).ToList();

        return Ok(result);
    }

    /// <summary>
    /// Get top N most popular symbols.
    /// </summary>
    [HttpGet("top")]
    public async Task<IActionResult> GetTopPopular([FromQuery] int limit = 10)
    {
        limit = Math.Clamp(limit, 1, 100);

        var top = await _db.StockPopularities
            .AsNoTracking()
            .Where(s => s.WatchlistCount > 0)
            .OrderByDescending(s => s.WatchlistCount)
            .Take(limit)
            .Select(s => new StockPopularityDto(s.Symbol, s.WatchlistCount, s.UpdatedAt))
            .ToListAsync();

        return Ok(top);
    }
}

public record StockPopularityDto(string Symbol, int WatchlistCount, DateTime? UpdatedAt);
