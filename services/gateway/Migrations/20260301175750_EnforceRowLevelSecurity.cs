using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QuantPlatform.Gateway.Migrations
{
    /// <inheritdoc />
    public partial class EnforceRowLevelSecurity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION app_user_id()
                RETURNS uuid
                LANGUAGE plpgsql
                STABLE
                AS $$
                DECLARE session_value text;
                BEGIN
                    session_value := current_setting('app.current_user_id', true);
                    IF session_value IS NULL OR session_value = '' OR session_value = 'service' THEN
                        RETURN NULL;
                    END IF;

                    BEGIN
                        RETURN session_value::uuid;
                    EXCEPTION WHEN OTHERS THEN
                        RETURN NULL;
                    END;
                END;
                $$;
                """);

            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION app_is_service_context()
                RETURNS boolean
                LANGUAGE sql
                STABLE
                AS $$
                    SELECT COALESCE(current_setting('app.current_user_id', true), '') = 'service';
                $$;
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE "Watchlists" ENABLE ROW LEVEL SECURITY;
                ALTER TABLE "Watchlists" FORCE ROW LEVEL SECURITY;

                DROP POLICY IF EXISTS watchlists_rls_policy ON "Watchlists";
                CREATE POLICY watchlists_rls_policy ON "Watchlists"
                    USING (app_is_service_context() OR "UserId" = app_user_id())
                    WITH CHECK (app_is_service_context() OR "UserId" = app_user_id());
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE "WatchlistAssets" ENABLE ROW LEVEL SECURITY;
                ALTER TABLE "WatchlistAssets" FORCE ROW LEVEL SECURITY;

                DROP POLICY IF EXISTS watchlist_assets_rls_policy ON "WatchlistAssets";
                CREATE POLICY watchlist_assets_rls_policy ON "WatchlistAssets"
                    USING (
                        app_is_service_context()
                        OR EXISTS (
                            SELECT 1
                            FROM "Watchlists" w
                            WHERE w."Id" = "WatchlistId"
                              AND w."UserId" = app_user_id()
                        )
                    )
                    WITH CHECK (
                        app_is_service_context()
                        OR EXISTS (
                            SELECT 1
                            FROM "Watchlists" w
                            WHERE w."Id" = "WatchlistId"
                              AND w."UserId" = app_user_id()
                        )
                    );
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE "RiskSnapshots" ENABLE ROW LEVEL SECURITY;
                ALTER TABLE "RiskSnapshots" FORCE ROW LEVEL SECURITY;

                DROP POLICY IF EXISTS risk_snapshots_rls_policy ON "RiskSnapshots";
                CREATE POLICY risk_snapshots_rls_policy ON "RiskSnapshots"
                    USING (
                        app_is_service_context()
                        OR EXISTS (
                            SELECT 1
                            FROM "Watchlists" w
                            WHERE w."Id" = "WatchlistId"
                              AND w."UserId" = app_user_id()
                        )
                    )
                    WITH CHECK (
                        app_is_service_context()
                        OR EXISTS (
                            SELECT 1
                            FROM "Watchlists" w
                            WHERE w."Id" = "WatchlistId"
                              AND w."UserId" = app_user_id()
                        )
                    );
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE "StockAnalysisSnapshots" ENABLE ROW LEVEL SECURITY;
                ALTER TABLE "StockAnalysisSnapshots" FORCE ROW LEVEL SECURITY;

                DROP POLICY IF EXISTS stock_analysis_snapshots_rls_policy ON "StockAnalysisSnapshots";
                CREATE POLICY stock_analysis_snapshots_rls_policy ON "StockAnalysisSnapshots"
                    USING (
                        app_is_service_context()
                        OR EXISTS (
                            SELECT 1
                            FROM "Watchlists" w
                            WHERE w."Id" = "WatchlistId"
                              AND w."UserId" = app_user_id()
                        )
                    )
                    WITH CHECK (
                        app_is_service_context()
                        OR EXISTS (
                            SELECT 1
                            FROM "Watchlists" w
                            WHERE w."Id" = "WatchlistId"
                              AND w."UserId" = app_user_id()
                        )
                    );
                """);

            migrationBuilder.Sql(
                """
                ALTER TABLE "HistoryItems" ENABLE ROW LEVEL SECURITY;
                ALTER TABLE "HistoryItems" FORCE ROW LEVEL SECURITY;

                DROP POLICY IF EXISTS history_items_rls_policy ON "HistoryItems";
                CREATE POLICY history_items_rls_policy ON "HistoryItems"
                    USING (app_is_service_context() OR "UserId" = app_user_id())
                    WITH CHECK (app_is_service_context() OR "UserId" = app_user_id());
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP POLICY IF EXISTS history_items_rls_policy ON "HistoryItems";
                ALTER TABLE "HistoryItems" NO FORCE ROW LEVEL SECURITY;
                ALTER TABLE "HistoryItems" DISABLE ROW LEVEL SECURITY;
                """);

            migrationBuilder.Sql(
                """
                DROP POLICY IF EXISTS stock_analysis_snapshots_rls_policy ON "StockAnalysisSnapshots";
                ALTER TABLE "StockAnalysisSnapshots" NO FORCE ROW LEVEL SECURITY;
                ALTER TABLE "StockAnalysisSnapshots" DISABLE ROW LEVEL SECURITY;
                """);

            migrationBuilder.Sql(
                """
                DROP POLICY IF EXISTS risk_snapshots_rls_policy ON "RiskSnapshots";
                ALTER TABLE "RiskSnapshots" NO FORCE ROW LEVEL SECURITY;
                ALTER TABLE "RiskSnapshots" DISABLE ROW LEVEL SECURITY;
                """);

            migrationBuilder.Sql(
                """
                DROP POLICY IF EXISTS watchlist_assets_rls_policy ON "WatchlistAssets";
                ALTER TABLE "WatchlistAssets" NO FORCE ROW LEVEL SECURITY;
                ALTER TABLE "WatchlistAssets" DISABLE ROW LEVEL SECURITY;
                """);

            migrationBuilder.Sql(
                """
                DROP POLICY IF EXISTS watchlists_rls_policy ON "Watchlists";
                ALTER TABLE "Watchlists" NO FORCE ROW LEVEL SECURITY;
                ALTER TABLE "Watchlists" DISABLE ROW LEVEL SECURITY;
                """);

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS app_is_service_context();");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS app_user_id();");
        }
    }
}
