using System.Security.Cryptography;
using System.Text;

namespace QuantPlatform.Gateway.Auth;

public static class UserIdentityResolver
{
    public static Guid? ResolveUserGuid(string? userId, string? email)
    {
        if (Guid.TryParse(userId, out var parsed))
        {
            return parsed;
        }

        var normalizedEmail = NormalizeEmail(email);
        if (normalizedEmail == null)
        {
            return null;
        }

        return DeterministicGuidFromEmail(normalizedEmail);
    }

    public static string? NormalizeEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return null;
        }

        var normalized = email.Trim().ToLowerInvariant();
        if (normalized.Length == 0 || normalized.Length > 100 || !normalized.Contains('@'))
        {
            return null;
        }

        return normalized;
    }

    private static Guid DeterministicGuidFromEmail(string normalizedEmail)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(normalizedEmail));
        var guidBytes = bytes.Take(16).ToArray();

        // Mark as RFC 4122 variant and version 5-style UUID for deterministic identity mapping.
        guidBytes[6] = (byte)((guidBytes[6] & 0x0F) | 0x50);
        guidBytes[8] = (byte)((guidBytes[8] & 0x3F) | 0x80);

        return new Guid(guidBytes);
    }
}
