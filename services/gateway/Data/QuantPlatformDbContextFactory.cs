using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using QuantPlatform.Gateway.Config;

namespace QuantPlatform.Gateway.Data;

/// <summary>
/// Used by `dotnet ef` so migrations can be created without running the full app host.
/// </summary>
public sealed class QuantPlatformDbContextFactory : IDesignTimeDbContextFactory<QuantPlatformDbContext>
{
    public QuantPlatformDbContext CreateDbContext(string[] args)
    {
        var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development";

        var config = new ConfigurationBuilder()
            .SetBasePath(Directory.GetCurrentDirectory())
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile($"appsettings.{environment}.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        var connectionString = DbConnection.RequireDefaultConnectionString(config);

        var optionsBuilder = new DbContextOptionsBuilder<QuantPlatformDbContext>();
        optionsBuilder.UseNpgsql(connectionString);

        return new QuantPlatformDbContext(optionsBuilder.Options);
    }
}
