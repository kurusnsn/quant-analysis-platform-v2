using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;

namespace QuantPlatform.Gateway.Services;

public sealed class FeatureAccessService
{
    private readonly QuantPlatformDbContext _db;
    private readonly HashSet<string> _proEmailAllowlist;

    public FeatureAccessService(QuantPlatformDbContext db, IConfiguration config)
    {
        _db = db;
        _proEmailAllowlist = ParseEmailAllowlist(config["FEATURE_PRO_EMAILS"]);
    }

    public async Task<FeatureAccessDecision> EvaluateAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
    {
        if (user.Identity?.IsAuthenticated != true)
        {
            return FeatureAccessDecision.Deny("sign_in_required");
        }

        // Trusted upstream / dev tokens can carry plan=pro directly.
        if (string.Equals(user.GetPlan(), "pro", StringComparison.OrdinalIgnoreCase))
        {
            return FeatureAccessDecision.Allow("claim_pro");
        }

        var userGuid = UserIdentityResolver.ResolveUserGuid(user.GetUserId(), user.GetEmail());
        var normalizedEmail = UserIdentityResolver.NormalizeEmail(user.GetEmail());

        if (!string.IsNullOrWhiteSpace(normalizedEmail) && _proEmailAllowlist.Contains(normalizedEmail))
        {
            if (userGuid != null)
            {
                await EnsureProPlanAsync(userGuid.Value, normalizedEmail, cancellationToken);
            }

            return FeatureAccessDecision.Allow("email_allowlist");
        }

        if (userGuid != null)
        {
            var account = await _db.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userGuid.Value, cancellationToken);

            if (account != null && string.Equals(account.Plan, "pro", StringComparison.OrdinalIgnoreCase))
            {
                return FeatureAccessDecision.Allow("db_pro");
            }
        }

        return FeatureAccessDecision.Deny("pro_required");
    }

    private static HashSet<string> ParseEmailAllowlist(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }

        var emails = raw
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(UserIdentityResolver.NormalizeEmail)
            .Where(email => !string.IsNullOrWhiteSpace(email))
            .Select(email => email!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return emails;
    }

    private async Task EnsureProPlanAsync(Guid userId, string normalizedEmail, CancellationToken cancellationToken)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        if (user == null)
        {
            _db.Users.Add(new User
            {
                Id = userId,
                Email = normalizedEmail,
                DisplayName = string.Empty,
                Plan = "pro",
                BillingStatus = "active",
                PlanUpdatedAt = DateTime.UtcNow
            });

            await _db.SaveChangesAsync(cancellationToken);
            return;
        }

        var changed = false;

        if (!string.Equals(user.Plan, "pro", StringComparison.OrdinalIgnoreCase))
        {
            user.Plan = "pro";
            changed = true;
        }

        if (!string.Equals(user.BillingStatus, "active", StringComparison.OrdinalIgnoreCase))
        {
            user.BillingStatus = "active";
            changed = true;
        }

        if (changed)
        {
            user.PlanUpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);
        }
    }
}

public readonly record struct FeatureAccessDecision(bool HasAccess, string Reason)
{
    public static FeatureAccessDecision Allow(string reason) => new(true, reason);
    public static FeatureAccessDecision Deny(string reason) => new(false, reason);
}
