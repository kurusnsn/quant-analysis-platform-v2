namespace QuantPlatform.Gateway.Services;

public interface IStorageService
{
    Task<string> SaveReportAsync(string reportName, string content, string contentType = "application/json");
    Task<string> GetReportAsync(string reportId);
    Task DeleteReportAsync(string reportId);
}
