using Microsoft.Extensions.Configuration;

namespace QuantPlatform.Gateway.Config;

public static class DbConnection
{
    public static string RequireDefaultConnectionString(IConfiguration config)
    {
        var cs = config.GetConnectionString("DefaultConnection")
                 ?? config["ConnectionStrings__DefaultConnection"];
        if (!string.IsNullOrWhiteSpace(cs))
        {
            return cs;
        }

        var inContainer = string.Equals(
            config["DOTNET_RUNNING_IN_CONTAINER"],
            "true",
            StringComparison.OrdinalIgnoreCase);

        var host = config["POSTGRES_HOST"];
        if (string.IsNullOrWhiteSpace(host))
        {
            host = inContainer ? "postgres" : "localhost";
        }

        var db = config["POSTGRES_DB"];
        if (string.IsNullOrWhiteSpace(db))
        {
            db = "quant-platform_db";
        }

        var user = config["POSTGRES_USER"];
        if (string.IsNullOrWhiteSpace(user))
        {
            user = "quant-platform";
        }

        var pass = config["POSTGRES_PASSWORD"];
        if (string.IsNullOrWhiteSpace(pass))
        {
            throw new InvalidOperationException(
                "Missing database configuration. Set ConnectionStrings__DefaultConnection (preferred) "
                + "or POSTGRES_PASSWORD (and optionally POSTGRES_HOST/DB/USER).");
        }

        return $"Host={host};Database={db};Username={user};Password={pass}";
    }
}

