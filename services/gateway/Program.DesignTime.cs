using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Config;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

// Expose a host builder for EF tooling so it doesn't need to execute the full minimal hosting pipeline.
public partial class Program
{
    public static IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args)
            .ConfigureWebHostDefaults(webBuilder =>
            {
                webBuilder.ConfigureServices((context, services) =>
                {
                    var connectionString = DbConnection.RequireDefaultConnectionString(context.Configuration);

                    services.AddDbContext<QuantPlatformDbContext>(options => options.UseNpgsql(connectionString));
                });

                webBuilder.Configure(_ => { });
            });
}
