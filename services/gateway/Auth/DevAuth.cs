using System.Security.Claims;
using System.Text;
using System.Text.Json;

namespace QuantPlatform.Gateway.Auth;

public static class DevAuth
{
    public const string HeaderName = "X-QuantPlatform-Dev-User";

    private sealed record DevUser(string Id, string Email, string? DisplayName, string? Plan);

    public static ClaimsPrincipal? TryCreatePrincipal(string? headerValue)
    {
        if (string.IsNullOrWhiteSpace(headerValue))
        {
            return null;
        }

        try
        {
            var normalized = Uri.UnescapeDataString(headerValue);
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(normalized));
            var devUser = JsonSerializer.Deserialize<DevUser>(
                json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (devUser == null || string.IsNullOrWhiteSpace(devUser.Id) || string.IsNullOrWhiteSpace(devUser.Email))
            {
                return null;
            }

            if (!Guid.TryParse(devUser.Id, out var userId))
            {
                return null;
            }

            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, userId.ToString()),
                new(ClaimTypes.Email, devUser.Email)
            };

            if (!string.IsNullOrWhiteSpace(devUser.DisplayName))
            {
                claims.Add(new Claim(ClaimTypes.Name, devUser.DisplayName));
            }

            var normalizedPlan = devUser.Plan?.Trim().ToLowerInvariant();
            if (normalizedPlan != "free" && normalizedPlan != "pro")
            {
                normalizedPlan = "pro";
            }

            claims.Add(new Claim("plan", normalizedPlan));
            if (normalizedPlan == "pro")
            {
                claims.Add(new Claim(ClaimTypes.Role, "pro"));
            }

            var identity = new ClaimsIdentity(claims, "DevMock");
            return new ClaimsPrincipal(identity);
        }
        catch
        {
            return null;
        }
    }
}
