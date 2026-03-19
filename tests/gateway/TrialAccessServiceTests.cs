using System.Security.Claims;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace QuantPlatform.Gateway.Tests;

public class TrialAccessServiceTests
{
    [Fact]
    public async Task EvaluateAsync_LocksExpiredFreeUser()
    {
        var userId = Guid.NewGuid();
        await using var db = BuildDbContext();
        db.Users.Add(new User
        {
            Id = userId,
            Email = "free@example.com",
            Plan = "free",
            CreatedAt = DateTime.UtcNow.AddDays(-14),
        });
        await db.SaveChangesAsync();

        var service = BuildService(db, trialDays: 7);
        var principal = BuildPrincipal(userId, "free@example.com");

        var result = await service.EvaluateAsync(principal, CancellationToken.None);

        Assert.True(result.IsLocked);
        Assert.Equal("trial_expired", result.Reason);
    }

    [Fact]
    public async Task EvaluateAsync_AllowsProUserEvenWhenTrialExpired()
    {
        var userId = Guid.NewGuid();
        await using var db = BuildDbContext();
        db.Users.Add(new User
        {
            Id = userId,
            Email = "pro@example.com",
            Plan = "pro",
            BillingStatus = "active",
            CreatedAt = DateTime.UtcNow.AddDays(-120),
        });
        await db.SaveChangesAsync();

        var service = BuildService(db, trialDays: 7);
        var principal = BuildPrincipal(userId, "pro@example.com");

        var result = await service.EvaluateAsync(principal, CancellationToken.None);

        Assert.False(result.IsLocked);
        Assert.Equal("pro", result.Reason);
    }

    [Fact]
    public async Task EvaluateAsync_LocksExpiredUser_WithNonGuidIdentityUsingEmailFallback()
    {
        const string email = "google-user@example.com";
        var derivedUserId = UserIdentityResolver.ResolveUserGuid("google-subject", email);
        Assert.NotNull(derivedUserId);

        await using var db = BuildDbContext();
        db.Users.Add(new User
        {
            Id = derivedUserId!.Value,
            Email = email,
            Plan = "free",
            CreatedAt = DateTime.UtcNow.AddDays(-30),
        });
        await db.SaveChangesAsync();

        var service = BuildService(db, trialDays: 7);
        var principal = BuildPrincipal(
            userId: "google-subject",
            email: email);

        var result = await service.EvaluateAsync(principal, CancellationToken.None);

        Assert.True(result.IsLocked);
        Assert.Equal("trial_expired", result.Reason);
    }

    private static QuantPlatformDbContext BuildDbContext()
    {
        var options = new DbContextOptionsBuilder<QuantPlatformDbContext>()
            .UseInMemoryDatabase(databaseName: $"trial-access-{Guid.NewGuid():N}")
            .Options;
        return new QuantPlatformDbContext(options);
    }

    private static TrialAccessService BuildService(QuantPlatformDbContext db, int trialDays)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["TRIAL_LOCK_ENABLED"] = "true",
                ["TRIAL_LOCK_DAYS"] = trialDays.ToString(),
            })
            .Build();
        return new TrialAccessService(db, config, NullLogger<TrialAccessService>.Instance);
    }

    private static ClaimsPrincipal BuildPrincipal(Guid userId, string email) =>
        BuildPrincipal(userId.ToString(), email);

    private static ClaimsPrincipal BuildPrincipal(string userId, string email)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId),
            new Claim(ClaimTypes.Email, email),
        };
        var identity = new ClaimsIdentity(claims, authenticationType: "Test");
        return new ClaimsPrincipal(identity);
    }
}
