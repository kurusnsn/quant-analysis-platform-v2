using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QuantPlatform.Gateway.Migrations
{
    /// <inheritdoc />
    public partial class LockDownDbRolePrivileges : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $$
                DECLARE role_name name := current_user;
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM pg_roles
                        WHERE rolname = role_name
                          AND rolsuper
                    ) THEN
                        EXECUTE format(
                            'ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
                            role_name
                        );
                    END IF;
                END
                $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Intentionally irreversible: least-privilege role hardening should not be rolled back automatically.
        }
    }
}
