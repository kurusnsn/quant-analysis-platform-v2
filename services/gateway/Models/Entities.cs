using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace QuantPlatform.Gateway.Models;

public class User
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();
    
    [Required]
    [MaxLength(100)]
    public string Email { get; set; } = string.Empty;
    
    [MaxLength(100)]
    public string DisplayName { get; set; } = string.Empty;

    [MaxLength(20)]
    public string Plan { get; set; } = "free";

    [MaxLength(64)]
    public string? StripeCustomerId { get; set; }

    [MaxLength(64)]
    public string? StripeSubscriptionId { get; set; }

    [MaxLength(32)]
    public string? BillingStatus { get; set; }

    public bool CancelAtPeriodEnd { get; set; }

    public DateTime? SubscriptionCurrentPeriodEnd { get; set; }

    public DateTime? PlanUpdatedAt { get; set; }
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation
    [JsonIgnore]
    public ICollection<Watchlist> Watchlists { get; set; } = new List<Watchlist>();
}

public class Watchlist
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();
    
    [Required]
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;
    
    public string RiskLevel { get; set; } = "Unknown";
    
    public double Correlation { get; set; }
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    
    // Foreign Key
    public Guid? UserId { get; set; }

    [JsonIgnore]
    public User? User { get; set; }
    
    // Navigation
    public ICollection<WatchlistAsset> Assets { get; set; } = new List<WatchlistAsset>();
    public ICollection<RiskSnapshot> RiskSnapshots { get; set; } = new List<RiskSnapshot>();
}

public class WatchlistAsset
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();
    
    [Required]
    [MaxLength(20)]
    public string Symbol { get; set; } = string.Empty;
    
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;
    
    public double Weight { get; set; } = 1.0;
    
    // Foreign Key
    public Guid WatchlistId { get; set; }

    [JsonIgnore]
    public Watchlist Watchlist { get; set; } = null!;
}

public class RiskSnapshot
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();
    
    public DateTime CalculatedAt { get; set; } = DateTime.UtcNow;
    
    // Core metrics
    public double Volatility { get; set; }
    public double Var95 { get; set; }
    public double CVaR95 { get; set; }
    public double LossProbability30d { get; set; }
    public string Regime { get; set; } = "unknown";
    
    // Full JSON payload from AI engine
    [Column(TypeName = "jsonb")]
    public string? RawPayload { get; set; }

    public string? ReportS3Key { get; set; }

    // AI-generated narrative explanation
    public string? Narrative { get; set; }

    // Foreign Key
    public Guid WatchlistId { get; set; }

    [JsonIgnore]
    public Watchlist Watchlist { get; set; } = null!;
}

public class StockAnalysisSnapshot
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    public string TickerSymbol { get; set; } = string.Empty;

    public DateTime CalculatedAt { get; set; } = DateTime.UtcNow;

    // Risk metrics
    public double Volatility { get; set; }
    public double Sharpe { get; set; }
    public double Var95 { get; set; }
    public double CVaR95 { get; set; }

    // AI-generated narrative
    public string? Narrative { get; set; }

    // News sentiment data
    public int RelatedNewsCount { get; set; }
    public string? Sentiment { get; set; }

    // Foreign Key
    public Guid WatchlistId { get; set; }

    [JsonIgnore]
    public Watchlist Watchlist { get; set; } = null!;
}

public class HistoryItem
{
    [Key]
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    public Guid UserId { get; set; }

    [Required]
    [MaxLength(50)]
    public string Kind { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [MaxLength(200)]
    public string? Title { get; set; }

    [MaxLength(5000)]
    public string? Prompt { get; set; }

    public Guid? WatchlistId { get; set; }

    [MaxLength(200)]
    public string? WatchlistName { get; set; }

    // Snapshot of tickers the generation/analysis was based on (watchlist contents, asset list, etc).
    public string[] Tickers { get; set; } = Array.Empty<string>();

    // JSON payload of the generated output (raw response from AI engine/gateway).
    [Column(TypeName = "jsonb")]
    public string Payload { get; set; } = "{}";
}

public class StockPopularity
{
    [Key]
    [MaxLength(20)]
    public string Symbol { get; set; } = string.Empty;

    public int WatchlistCount { get; set; } = 0;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class TickerMetadata
{
    [Key]
    [MaxLength(20)]
    public string Symbol { get; set; } = string.Empty;

    [Required]
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(50)]
    public string? Exchange { get; set; }

    [MaxLength(512)]
    public string? LogoUrl { get; set; }

    [MaxLength(512)]
    public string? IconUrl { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// Per-user engagement (follow / favorite) used for global aggregate counts and user state.
// Composite keys prevent double-counting a single user.
public class UserStockFollow
{
    [Required]
    public Guid UserId { get; set; }

    [Required]
    [MaxLength(20)]
    public string Symbol { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [JsonIgnore]
    public User? User { get; set; }
}

public class UserStockFavorite
{
    [Required]
    public Guid UserId { get; set; }

    [Required]
    [MaxLength(20)]
    public string Symbol { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [JsonIgnore]
    public User? User { get; set; }
}
