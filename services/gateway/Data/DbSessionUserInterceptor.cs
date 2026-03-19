using System.Data.Common;
using QuantPlatform.Gateway.Auth;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace QuantPlatform.Gateway.Data;

public sealed class DbSessionUserInterceptor : DbConnectionInterceptor
{
    public const string SessionSettingName = "app.current_user_id";
    public const string ServiceContextValue = "service";

    private readonly IHttpContextAccessor _httpContextAccessor;

    public DbSessionUserInterceptor(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        SetSessionUser(connection);
    }

    public override async Task ConnectionOpenedAsync(
        DbConnection connection,
        ConnectionEndEventData eventData,
        CancellationToken cancellationToken = default)
    {
        await SetSessionUserAsync(connection, cancellationToken);
    }

    private void SetSessionUser(DbConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT set_config('{SessionSettingName}', @session_user, false);";

        var parameter = command.CreateParameter();
        parameter.ParameterName = "session_user";
        parameter.Value = ResolveSessionUser();
        command.Parameters.Add(parameter);

        command.ExecuteNonQuery();
    }

    private async Task SetSessionUserAsync(DbConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT set_config('{SessionSettingName}', @session_user, false);";

        var parameter = command.CreateParameter();
        parameter.ParameterName = "session_user";
        parameter.Value = ResolveSessionUser();
        command.Parameters.Add(parameter);

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private string ResolveSessionUser()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        if (user?.Identity?.IsAuthenticated != true)
        {
            return ServiceContextValue;
        }

        var userId = user.GetUserId();
        return Guid.TryParse(userId, out var guid)
            ? guid.ToString()
            : ServiceContextValue;
    }
}
