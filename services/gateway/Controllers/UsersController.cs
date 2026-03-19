using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;

namespace QuantPlatform.Gateway.Controllers;

[ApiController]
[Route("api/users")]
[Authorize(Policy = "Authenticated")]
public class UsersController : ControllerBase
{
    private const int UsernameMin = 3;
    private const int UsernameMax = 20;
    private static readonly Regex UsernameRegex = new("^[a-z0-9_]+$", RegexOptions.Compiled);

    private readonly QuantPlatformDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<UsersController> _logger;

    public UsersController(QuantPlatformDbContext db, IConfiguration config, ILogger<UsersController> logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    [AllowAnonymous]
    [HttpGet("username-available")]
    public async Task<IActionResult> UsernameAvailable([FromQuery] string username)
    {
        var normalized = NormalizeUsername(username);
        var error = ValidateUsername(normalized);

        if (error != null)
        {
            return Ok(new { available = false, reason = error });
        }

        var exists = await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.DisplayName != null && u.DisplayName.ToLowerInvariant() == normalized);

        return Ok(new { available = !exists });
    }

    [Authorize(Policy = "Authenticated")]
    [HttpGet("me")]
    public async Task<IActionResult> GetMe()
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var user = await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (user == null)
        {
            return NotFound();
        }

        return Ok(new
        {
            id = user.Id,
            email = user.Email,
            displayName = string.IsNullOrWhiteSpace(user.DisplayName) ? null : user.DisplayName
        });
    }

    [Authorize(Policy = "Authenticated")]
    [HttpPost("username")]
    public async Task<IActionResult> SetUsername([FromBody] SetUsernameRequest request)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Username))
        {
            return BadRequest(new { error = "Username is required." });
        }

        var normalized = NormalizeUsername(request.Username);
        var error = ValidateUsername(normalized);
        if (error != null)
        {
            return BadRequest(new { error });
        }

        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        var email = User.GetEmail();
        if (string.IsNullOrWhiteSpace(email))
        {
            return BadRequest(new { error = "Email claim missing from token." });
        }

        var usernameTaken = await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id != userId && u.DisplayName != null && u.DisplayName.ToLowerInvariant() == normalized);

        if (usernameTaken)
        {
            return Conflict(new { error = "Username already taken." });
        }

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
        {
            var emailOwner = await _db.Users.FirstOrDefaultAsync(u => u.Email == email);
            if (emailOwner != null && emailOwner.Id != userId)
            {
                return Conflict(new { error = "Email already registered." });
            }

            user = new User
            {
                Id = userId.Value,
                Email = email,
                DisplayName = normalized
            };
            _db.Users.Add(user);
        }
        else
        {
            user.Email = string.IsNullOrWhiteSpace(user.Email) ? email : user.Email;
            user.DisplayName = normalized;
        }

        await _db.SaveChangesAsync();

        return Ok(new
        {
            id = user.Id,
            email = user.Email,
            displayName = user.DisplayName
        });
    }

    [Authorize(Policy = "Authenticated")]
    [HttpDelete("me")]
    public async Task<IActionResult> DeleteMe()
    {
        var userId = User.GetUserGuid();
        if (userId == null)
        {
            return Unauthorized();
        }

        await using (var transaction = await _db.Database.BeginTransactionAsync())
        {
            await _db.HistoryItems
                .Where(h => h.UserId == userId.Value)
                .ExecuteDeleteAsync();

            await _db.Watchlists
                .Where(w => w.UserId == userId.Value)
                .ExecuteDeleteAsync();

            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
            if (user != null)
            {
                _db.Users.Remove(user);
                await _db.SaveChangesAsync();
            }

            await transaction.CommitAsync();
        }

        var authDeleted = await TryDeleteSupabaseAuthUserAsync(userId.Value);
        var message = authDeleted
            ? "Account deleted."
            : "Profile and local data deleted. Supabase auth user deletion was skipped.";

        return Ok(new
        {
            deleted = true,
            authDeleted,
            message,
        });
    }

    private async Task<bool> TryDeleteSupabaseAuthUserAsync(Guid userId)
    {
        var supabaseUrl = _config["SUPABASE_URL"]?.TrimEnd('/');
        var serviceRoleKey = _config["SUPABASE_SERVICE_ROLE_KEY"];
        if (string.IsNullOrWhiteSpace(supabaseUrl) || string.IsNullOrWhiteSpace(serviceRoleKey))
        {
            return false;
        }

        try
        {
            using var client = new HttpClient();
            using var request = new HttpRequestMessage(
                HttpMethod.Delete,
                $"{supabaseUrl}/auth/v1/admin/users/{userId}");

            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", serviceRoleKey);
            request.Headers.TryAddWithoutValidation("apikey", serviceRoleKey);

            using var response = await client.SendAsync(request);
            if (response.IsSuccessStatusCode)
            {
                return true;
            }

            var body = await response.Content.ReadAsStringAsync();
            _logger.LogWarning(
                "Supabase auth user delete failed for {UserId}. Status: {StatusCode}. Body: {Body}",
                userId,
                (int)response.StatusCode,
                body);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Supabase auth user delete request failed for {UserId}", userId);
            return false;
        }
    }

    private static string NormalizeUsername(string value)
    {
        return value.Trim().ToLowerInvariant();
    }

    private static string? ValidateUsername(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "Username is required.";
        }

        if (value.Length < UsernameMin || value.Length > UsernameMax)
        {
            return $"Username must be {UsernameMin}-{UsernameMax} characters.";
        }

        if (!UsernameRegex.IsMatch(value))
        {
            return "Username can only include lowercase letters, numbers, and underscore.";
        }

        return null;
    }

    public record SetUsernameRequest(string Username);
}
