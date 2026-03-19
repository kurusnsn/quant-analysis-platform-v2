using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QuantPlatform.Gateway.Migrations
{
    /// <inheritdoc />
    public partial class CreateHistoryItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "HistoryItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Prompt = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: true),
                    WatchlistId = table.Column<Guid>(type: "uuid", nullable: true),
                    WatchlistName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Tickers = table.Column<string[]>(type: "text[]", nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HistoryItems", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HistoryItems_UserId_CreatedAt",
                table: "HistoryItems",
                columns: new[] { "UserId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HistoryItems");
        }
    }
}
