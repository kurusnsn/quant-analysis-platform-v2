using System.Text;
using System.Text.Json;
using QuantPlatform.Gateway.Controllers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace QuantPlatform.Gateway.Tests;

public class BillingControllerWebhookTests
{
    [Fact]
    public async Task HandleWebhook_Returns503_WhenWebhookSecretMissing()
    {
        var controller = BuildController(new Dictionary<string, string?>());

        var result = await controller.HandleWebhook();

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, objectResult.StatusCode);
        Assert.Contains("Webhook not configured", Serialize(objectResult.Value));
    }

    [Fact]
    public async Task HandleWebhook_Returns503_WhenWebhookSecretIsReplaceMe()
    {
        var controller = BuildController(
            new Dictionary<string, string?> { ["STRIPE_WEBHOOK_SECRET"] = "REPLACE_ME" },
            signatureHeader: "t=1700000000,v1=fake");

        var result = await controller.HandleWebhook();

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, objectResult.StatusCode);
        Assert.Contains("Webhook not configured", Serialize(objectResult.Value));
    }

    [Fact]
    public async Task HandleWebhook_Returns400_WhenStripeSignatureHeaderMissing()
    {
        var controller = BuildController(
            new Dictionary<string, string?> { ["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret" });

        var result = await controller.HandleWebhook();

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Contains("Missing Stripe-Signature header", Serialize(badRequest.Value));
    }

    [Fact]
    public async Task HandleWebhook_Returns400_WhenStripeSignatureInvalid()
    {
        var controller = BuildController(
            new Dictionary<string, string?> { ["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret" },
            body: "{\"id\":\"evt_test\",\"object\":\"event\",\"type\":\"checkout.session.completed\"}",
            signatureHeader: "t=1700000000,v1=bad_signature");

        var result = await controller.HandleWebhook();

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Contains("Webhook signature verification failed", Serialize(badRequest.Value));
    }

    private static BillingController BuildController(
        Dictionary<string, string?> configValues,
        string body = "{}",
        string? signatureHeader = null)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(configValues)
            .Build();

        var controller = new BillingController(config, NullLogger<BillingController>.Instance);
        var context = new DefaultHttpContext();
        context.Request.ContentType = "application/json";
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));

        if (!string.IsNullOrWhiteSpace(signatureHeader))
        {
            context.Request.Headers["Stripe-Signature"] = signatureHeader;
        }

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = context
        };

        return controller;
    }

    private static string Serialize(object? value) =>
        JsonSerializer.Serialize(value);
}
