using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QuantPlatform.Gateway.Migrations
{
    /// <inheritdoc />
    public partial class CreateStockAnalysisSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StockAnalysisSnapshots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TickerSymbol = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CalculatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Volatility = table.Column<double>(type: "double precision", nullable: false),
                    Sharpe = table.Column<double>(type: "double precision", nullable: false),
                    Var95 = table.Column<double>(type: "double precision", nullable: false),
                    CVaR95 = table.Column<double>(type: "double precision", nullable: false),
                    Narrative = table.Column<string>(type: "text", nullable: true),
                    RelatedNewsCount = table.Column<int>(type: "integer", nullable: false),
                    Sentiment = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    WatchlistId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockAnalysisSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StockAnalysisSnapshots_Watchlists_WatchlistId",
                        column: x => x.WatchlistId,
                        principalTable: "Watchlists",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StockAnalysisSnapshots_TickerSymbol_CalculatedAt",
                table: "StockAnalysisSnapshots",
                columns: new[] { "TickerSymbol", "CalculatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StockAnalysisSnapshots_WatchlistId",
                table: "StockAnalysisSnapshots",
                column: "WatchlistId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StockAnalysisSnapshots");
        }
    }
}
