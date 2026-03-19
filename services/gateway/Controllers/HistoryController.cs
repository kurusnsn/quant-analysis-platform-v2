using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;
using QuantPlatform.Gateway.Services;

namespace QuantPlatform.Gateway.Controllers;

[ApiController]
[Route("api/history")]
[Authorize(Policy = "Authenticated")]
public sealed class HistoryController : ControllerBase
{
    private const int DefaultPageSize = 25;
    private const int MaxPageSize = 100;

    private readonly QuantPlatformDbContext _db;

    public HistoryController(QuantPlatformDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        [FromQuery] Guid? watchlistId = null,
        [FromQuery] string? ticker = null,
        [FromQuery] string? kind = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = DefaultPageSize)
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }
        var userGuid = userId.Value;

        if (page < 1)
        {
            page = 1;
        }

        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);

        string? normalizedTicker = null;
        if (!string.IsNullOrWhiteSpace(ticker))
        {
            if (!TickerValidation.IsValid(ticker))
            {
                return BadRequest(new { error = "Invalid ticker format", ticker });
            }

            normalizedTicker = TickerValidation.Normalize(ticker);
        }

        var query = _db.HistoryItems
            .AsNoTracking()
            .Where(h => h.UserId == userGuid);

        if (from.HasValue)
        {
            var fromUtc = from.Value.Kind == DateTimeKind.Utc ? from.Value : from.Value.ToUniversalTime();
            query = query.Where(h => h.CreatedAt >= fromUtc);
        }

        if (to.HasValue)
        {
            var toUtc = to.Value.Kind == DateTimeKind.Utc ? to.Value : to.Value.ToUniversalTime();
            query = query.Where(h => h.CreatedAt <= toUtc);
        }

        if (watchlistId.HasValue)
        {
            query = query.Where(h => h.WatchlistId == watchlistId);
        }

        if (!string.IsNullOrWhiteSpace(kind))
        {
            query = query.Where(h => h.Kind == kind);
        }

        if (!string.IsNullOrWhiteSpace(normalizedTicker))
        {
            query = query.Where(h => h.Tickers.Contains(normalizedTicker));
        }

        var total = await query.CountAsync();

        var items = await query
            .OrderByDescending(h => h.CreatedAt)
            .ThenByDescending(h => h.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(h => new
            {
                id = h.Id,
                kind = h.Kind,
                createdAt = h.CreatedAt,
                title = h.Title,
                prompt = h.Prompt,
                watchlistId = h.WatchlistId,
                watchlistName = h.WatchlistName,
                tickers = h.Tickers,
                payload = h.Payload
            })
            .ToListAsync();

        return Ok(new
        {
            page,
            pageSize,
            total,
            items
        });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }
        var userGuid = userId.Value;

        var item = await _db.HistoryItems
            .AsNoTracking()
            .Where(h => h.UserId == userGuid && h.Id == id)
            .Select(h => new
            {
                id = h.Id,
                kind = h.Kind,
                createdAt = h.CreatedAt,
                title = h.Title,
                prompt = h.Prompt,
                watchlistId = h.WatchlistId,
                watchlistName = h.WatchlistName,
                tickers = h.Tickers,
                payload = h.Payload
            })
            .FirstOrDefaultAsync();

        return item == null ? NotFound() : Ok(item);
    }
}
