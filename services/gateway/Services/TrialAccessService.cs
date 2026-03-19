using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;

namespace QuantPlatform.Gateway.Services;

public sealed class TrialAccessService
{
    private const int DefaultTrialDays = 7;

    private readonly QuantPlatformDbContext _db;
    private readonly ILogger<TrialAccessService> _logger;
    private readonly int _trialDays;
    private readonly bool _enabled;

    public TrialAccessService(
        QuantPlatformDbContext db,
        IConfiguration config,
        ILogger<TrialAccessService> logger)
    {
        _db = db;
        _logger = logger;
        _trialDays = Math.Clamp(config.GetValue<int?>("TRIAL_LOCK_DAYS") ?? DefaultTrialDays, 1, 365);
        _enabled = config.GetValue<bool?>("TRIAL_LOCK_ENABLED") ?? true;
    }

    public async Task<TrialAccessResult> EvaluateAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        if (!_enabled)
        {
            return TrialAccessResult.AllowDisabled(_trialDays);
        }

        // Honor explicit pro claim first (dev auth or trusted upstream token enrichment).
        if (user.GetPlan() == "pro")
        {
            return TrialAccessResult.AllowPro(_trialDays);
        }

        var userId = UserIdentityResolver.ResolveUserGuid(user.GetUserId(), user.GetEmail());
        if (userId == null)
        {
            return TrialAccessResult.AllowNoIdentity(_trialDays);
        }

        var account = await EnsureUserExistsAsync(userId.Value, user.GetEmail(), cancellationToken);
        if (string.Equals(account.Plan, "pro", StringComparison.OrdinalIgnoreCase))
        {
            return TrialAccessResult.AllowPro(_trialDays);
        }

        var trialStartedAt = EnsureUtc(account.CreatedAt);
        var trialEndsAt = trialStartedAt.AddDays(_trialDays);
        var remaining = trialEndsAt - DateTime.UtcNow;

        return remaining <= TimeSpan.Zero
            ? TrialAccessResult.Locked(trialStartedAt, trialEndsAt, _trialDays)
            : TrialAccessResult.AllowTrial(trialStartedAt, trialEndsAt, _trialDays, remaining);
    }

    private async Task<User> EnsureUserExistsAsync(Guid userId, string? emailClaim, CancellationToken cancellationToken)
    {
        var existing = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (existing != null)
        {
            return existing;
        }

        var email = BuildSafeEmail(userId, emailClaim);
        var emailTaken = await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Email == email && u.Id != userId, cancellationToken);

        if (emailTaken)
        {
            email = BuildFallbackEmail(userId);
        }

        var created = new User
        {
            Id = userId,
            Email = email,
            DisplayName = string.Empty,
            CreatedAt = DateTime.UtcNow
        };

        _db.Users.Add(created);

        try
        {
            await _db.SaveChangesAsync(cancellationToken);
            return created;
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Trial access user bootstrap conflict for {UserId}", userId);
            _db.Entry(created).State = EntityState.Detached;

            var recovered = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
            if (recovered != null)
            {
                return recovered;
            }

            throw;
        }
    }

    private static string BuildSafeEmail(Guid userId, string? emailClaim)
    {
        if (string.IsNullOrWhiteSpace(emailClaim))
        {
            return BuildFallbackEmail(userId);
        }

        var trimmed = emailClaim.Trim().ToLowerInvariant();
        if (trimmed.Length == 0 || trimmed.Length > 100 || !trimmed.Contains('@'))
        {
            return BuildFallbackEmail(userId);
        }

        return trimmed;
    }

    private static string BuildFallbackEmail(Guid userId)
    {
        return $"user-{userId:N}@quant-platform.local";
    }

    private static DateTime EnsureUtc(DateTime value)
    {
        return value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };
    }
}

public sealed record TrialAccessResult(
    bool IsLocked,
    string Reason,
    int TrialDays,
    DateTime? TrialStartedAt = null,
    DateTime? TrialEndsAt = null,
    double? RemainingDays = null)
{
    public static TrialAccessResult AllowDisabled(int trialDays) =>
        new(false, "disabled", trialDays);

    public static TrialAccessResult AllowPro(int trialDays) =>
        new(false, "pro", trialDays);

    public static TrialAccessResult AllowNoIdentity(int trialDays) =>
        new(false, "no_identity", trialDays);

    public static TrialAccessResult AllowTrial(
        DateTime trialStartedAt,
        DateTime trialEndsAt,
        int trialDays,
        TimeSpan remaining) =>
        new(false, "trial_active", trialDays, trialStartedAt, trialEndsAt, RoundDays(remaining));

    public static TrialAccessResult Locked(
        DateTime trialStartedAt,
        DateTime trialEndsAt,
        int trialDays) =>
        new(true, "trial_expired", trialDays, trialStartedAt, trialEndsAt, 0);

    private static double RoundDays(TimeSpan remaining)
    {
        return Math.Round(Math.Max(0, remaining.TotalDays), 2);
    }
}
