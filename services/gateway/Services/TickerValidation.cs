using System.Text.RegularExpressions;

namespace QuantPlatform.Gateway.Services;

public static class TickerValidation
{
    private static readonly Regex TickerRegex = new("^[A-Z0-9.^-]{1,10}$", RegexOptions.Compiled);

    public static bool IsValid(string? ticker)
    {
        if (string.IsNullOrWhiteSpace(ticker))
        {
            return false;
        }

        var normalized = ticker.Trim().ToUpperInvariant();
        return TickerRegex.IsMatch(normalized);
    }

    public static string Normalize(string ticker)
    {
        return ticker.Trim().ToUpperInvariant();
    }
}
