using Microsoft.EntityFrameworkCore;
using QuantPlatform.Gateway.Models;

namespace QuantPlatform.Gateway.Data;

public class QuantPlatformDbContext : DbContext
{
    public QuantPlatformDbContext(DbContextOptions<QuantPlatformDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users { get; set; }
    public DbSet<Watchlist> Watchlists { get; set; }
    public DbSet<WatchlistAsset> WatchlistAssets { get; set; }
    public DbSet<RiskSnapshot> RiskSnapshots { get; set; }
    public DbSet<StockAnalysisSnapshot> StockAnalysisSnapshots { get; set; }
    public DbSet<HistoryItem> HistoryItems { get; set; }
    public DbSet<StockPopularity> StockPopularities { get; set; }
    public DbSet<TickerMetadata> TickerMetadata { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // TickerMetadata (cached ticker list and logos)
        modelBuilder.Entity<TickerMetadata>(entity =>
        {
            entity.HasKey(t => t.Symbol);
            entity.Property(t => t.Symbol).HasMaxLength(20);
        });

        // User
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(e => e.Email).IsUnique();
            entity.Property(e => e.Plan)
                .HasMaxLength(20)
                .HasDefaultValue("free");
            entity.HasIndex(e => e.StripeCustomerId).IsUnique();
            entity.HasIndex(e => e.StripeSubscriptionId).IsUnique();
        });

        // Watchlist
        modelBuilder.Entity<Watchlist>(entity =>
        {
            entity.HasOne(w => w.User)
                  .WithMany(u => u.Watchlists)
                  .HasForeignKey(w => w.UserId)
                  .OnDelete(DeleteBehavior.SetNull);
        });

        // WatchlistAsset
        modelBuilder.Entity<WatchlistAsset>(entity =>
        {
            entity.HasOne(a => a.Watchlist)
                  .WithMany(w => w.Assets)
                  .HasForeignKey(a => a.WatchlistId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        // RiskSnapshot
        modelBuilder.Entity<RiskSnapshot>(entity =>
        {
            entity.HasOne(r => r.Watchlist)
                  .WithMany(w => w.RiskSnapshots)
                  .HasForeignKey(r => r.WatchlistId)
                  .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(r => r.CalculatedAt);
        });

        // StockAnalysisSnapshot
        modelBuilder.Entity<StockAnalysisSnapshot>(entity =>
        {
            entity.HasOne(s => s.Watchlist)
                  .WithMany()
                  .HasForeignKey(s => s.WatchlistId)
                  .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(s => new { s.TickerSymbol, s.CalculatedAt });
            entity.Property(s => s.TickerSymbol).HasMaxLength(20);
            entity.Property(s => s.Sentiment).HasMaxLength(50);
        });

        // HistoryItem (user-scoped history of generated outputs)
        modelBuilder.Entity<HistoryItem>(entity =>
        {
            entity.HasIndex(h => new { h.UserId, h.CreatedAt });

            entity.Property(h => h.Kind).HasMaxLength(50);
            entity.Property(h => h.Title).HasMaxLength(200);
            entity.Property(h => h.Prompt).HasMaxLength(5000);
            entity.Property(h => h.WatchlistName).HasMaxLength(200);

            // Map CLR string[] to Postgres text[]
            entity.Property(h => h.Tickers).HasColumnType("text[]");
            entity.Property(h => h.Payload).HasColumnType("jsonb");
        });

        // StockPopularity (global aggregate counts of symbols in watchlists)
        modelBuilder.Entity<StockPopularity>(entity =>
        {
            entity.HasKey(s => s.Symbol);
            entity.Property(s => s.Symbol).HasMaxLength(20);
        });
    }
}
