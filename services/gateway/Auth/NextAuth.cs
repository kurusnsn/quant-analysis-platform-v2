using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.IdentityModel.Tokens;
using Microsoft.IdentityModel.JsonWebTokens;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Text;
using QuantPlatform.Gateway.Observability;
using OpenTelemetry.Trace;

namespace QuantPlatform.Gateway.Auth;

public static class AuthExtensions
{
    public static IServiceCollection AddNextAuth(this IServiceCollection services, IConfiguration config)
    {
        var nextAuthSecret = config["NEXTAUTH_SECRET"];
        if (string.IsNullOrWhiteSpace(nextAuthSecret))
        {
            nextAuthSecret = config["NextAuth:Secret"];
        }

        if (string.IsNullOrWhiteSpace(nextAuthSecret))
        {
            Console.WriteLine("⚠️ NEXTAUTH_SECRET not set - auth disabled");
            return services;
        }

        Console.WriteLine("✅ Configuring NextAuth JWT validation");

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(nextAuthSecret));
        var authJsDecryptionKeys = BuildAuthJsDecryptionKeys(nextAuthSecret);

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    RequireSignedTokens = false,
                    IssuerSigningKey = key,
                    ClockSkew = TimeSpan.FromMinutes(5),
                    TokenDecryptionKeys = authJsDecryptionKeys,
                    ValidAlgorithms = new[]
                    {
                        SecurityAlgorithms.HmacSha256, // internal/dev HS256 bearer tokens
                        SecurityAlgorithms.HmacSha384,
                        SecurityAlgorithms.HmacSha512,
                        SecurityAlgorithms.Aes256CbcHmacSha512, // Auth.js default JWE enc
                        SecurityAlgorithms.Aes256Gcm, // Auth.js fallback/rotation support
                    },
                    // NextAuth v5 uses "sub" for the user id
                    NameClaimType = "sub",
                };

                // NextAuth session tokens are not standard JWTs — they're encrypted JWE tokens.
                // We need to handle the case where the token is a session cookie value
                // rather than a standard JWT bearer token.
                options.RequireHttpsMetadata = !string.Equals(
                    config["ASPNETCORE_ENVIRONMENT"],
                    "Development",
                    StringComparison.OrdinalIgnoreCase
                );

                options.Events = new JwtBearerEvents
                {
                    OnAuthenticationFailed = context =>
                    {
                        StopAuthActivity(context.HttpContext, "failed", context.Exception);
                        Console.WriteLine($"❌ Auth failed: {context.Exception.Message}");
                        return Task.CompletedTask;
                    },
                    OnTokenValidated = context =>
                    {
                        StopAuthActivity(context.HttpContext, "validated", null);
                        Console.WriteLine("✅ User authenticated");
                        return Task.CompletedTask;
                    },
                    OnMessageReceived = context =>
                    {
                        StartAuthActivity(context.HttpContext);
                        // Also check for token in query string (for WebSocket support)
                        var accessToken = context.Request.Query["access_token"];
                        if (!string.IsNullOrEmpty(accessToken))
                        {
                            context.Token = accessToken;
                        }
                        return Task.CompletedTask;
                    },
                    OnChallenge = context =>
                    {
                        StopAuthActivity(context.HttpContext, "challenged", null);
                        return Task.CompletedTask;
                    }
                };
            });

        services.AddAuthorization(options =>
        {
            options.AddPolicy("Authenticated", policy =>
                policy.RequireAuthenticatedUser());
        });

        return services;
    }

    private static IReadOnlyList<SecurityKey> BuildAuthJsDecryptionKeys(string nextAuthSecret)
    {
        // Auth.js derives encryption keys from NEXTAUTH_SECRET + cookie name (salt).
        // Try both secure and non-secure cookie names to support prod/dev tokens.
        var salts = new[]
        {
            "__Secure-authjs.session-token",
            "authjs.session-token",
        };

        var keys = new List<SecurityKey>(salts.Length * 2);
        foreach (var salt in salts)
        {
            keys.Add(new SymmetricSecurityKey(DeriveAuthJsEncryptionKey(nextAuthSecret, salt, 64)));
            keys.Add(new SymmetricSecurityKey(DeriveAuthJsEncryptionKey(nextAuthSecret, salt, 32)));
        }

        return keys;
    }

    private static byte[] DeriveAuthJsEncryptionKey(string secret, string salt, int length)
    {
        var keyMaterial = Encoding.UTF8.GetBytes(secret);
        var saltBytes = Encoding.UTF8.GetBytes(salt);
        var info = Encoding.UTF8.GetBytes($"Auth.js Generated Encryption Key ({salt})");
        return HkdfSha256(keyMaterial, saltBytes, info, length);
    }

    private static byte[] HkdfSha256(byte[] ikm, byte[] salt, byte[] info, int length)
    {
        var effectiveSalt = salt.Length > 0 ? salt : new byte[32];
        using var extractHmac = new HMACSHA256(effectiveSalt);
        var prk = extractHmac.ComputeHash(ikm);

        try
        {
            var okm = new byte[length];
            var previous = Array.Empty<byte>();
            var offset = 0;
            byte counter = 1;

            while (offset < length)
            {
                using var expandHmac = new HMACSHA256(prk);
                var input = new byte[previous.Length + info.Length + 1];
                Buffer.BlockCopy(previous, 0, input, 0, previous.Length);
                Buffer.BlockCopy(info, 0, input, previous.Length, info.Length);
                input[^1] = counter;

                previous = expandHmac.ComputeHash(input);
                var toCopy = Math.Min(previous.Length, length - offset);
                Buffer.BlockCopy(previous, 0, okm, offset, toCopy);
                offset += toCopy;
                counter++;
            }

            return okm;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(prk);
        }
    }

    private const string AuthActivityKey = "quant-platform.auth.activity";

    private static void StartAuthActivity(HttpContext context)
    {
        var activity = GatewayTelemetry.ActivitySource.StartActivity("auth.verification", ActivityKind.Internal);
        if (activity != null)
        {
            context.Items[AuthActivityKey] = activity;
        }
    }

    private static void StopAuthActivity(HttpContext context, string result, Exception? exception)
    {
        if (!context.Items.TryGetValue(AuthActivityKey, out var value) || value is not Activity activity)
        {
            return;
        }

        activity.SetTag("auth.result", result);
        if (exception != null)
        {
            activity.RecordException(exception);
            activity.SetTag("error", true);
        }

        activity.Stop();
        context.Items.Remove(AuthActivityKey);
    }
}

public static class ClaimsPrincipalExtensions
{
    public static string? GetUserId(this ClaimsPrincipal user)
    {
        return user.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? user.FindFirst("sub")?.Value;
    }

    public static string? GetEmail(this ClaimsPrincipal user)
    {
        return user.FindFirst(ClaimTypes.Email)?.Value
            ?? user.FindFirst("email")?.Value;
    }

    public static Guid? GetUserGuid(this ClaimsPrincipal user)
    {
        var id = user.GetUserId();
        if (Guid.TryParse(id, out var guid))
        {
            return guid;
        }

        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        // OAuth providers can use non-GUID "sub" values (e.g., Google numeric IDs).
        // Derive a stable GUID so downstream persistence remains consistent.
        var email = user.GetEmail();
        var seed = !string.IsNullOrWhiteSpace(email)
            ? $"email:{email.Trim().ToLowerInvariant()}"
            : $"sub:{id.Trim()}";

        return CreateDeterministicGuid(seed);
    }

    private static Guid CreateDeterministicGuid(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        Span<byte> bytes = stackalloc byte[16];
        hash.AsSpan(0, 16).CopyTo(bytes);

        // RFC 4122 variant + version 4 layout for compatibility.
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x40);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);

        return new Guid(bytes);
    }

    public static string GetPlan(this ClaimsPrincipal user)
    {
        var plan = user.FindFirst("plan")?.Value?.Trim().ToLowerInvariant();
        return plan == "pro" ? "pro" : "free";
    }
}
