using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Stripe;
using Stripe.Checkout;
using QuantPlatform.Gateway.Auth;
using QuantPlatform.Gateway.Data;
using QuantPlatform.Gateway.Models;

namespace QuantPlatform.Gateway.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = "Authenticated")]
public class BillingController : ControllerBase
{
    private const long ProMonthlyPriceCents = 299;
    private const string ProCurrency = "usd";
    private const string ProInterval = "month";

    private static readonly HashSet<string> DefaultAllowedReturnHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "quant-platform.com",
        "www.quant-platform.com",
        "app.quant-platform.com",
        "localhost",
        "127.0.0.1"
    };

    private readonly IConfiguration _config;
    private readonly ILogger<BillingController> _logger;
    private readonly QuantPlatformDbContext? _db;

    public BillingController(
        IConfiguration config,
        ILogger<BillingController> logger,
        QuantPlatformDbContext? db = null)
    {
        _config = config;
        _logger = logger;
        _db = db;

        var stripeApiKey = NormalizeConfigValue(_config["STRIPE_SECRET_KEY"])
            ?? NormalizeConfigValue(_config["Stripe:SecretKey"]);

        if (!string.IsNullOrWhiteSpace(stripeApiKey))
        {
            StripeConfiguration.ApiKey = stripeApiKey;
        }
    }

    /// <summary>
    /// Returns billing summary for the authenticated user.
    /// </summary>
    [EnableRateLimiting("billing-read")]
    [HttpGet("summary")]
    public async Task<IActionResult> GetBillingSummary([FromQuery] int historyLimit = 12)
    {
        var email = User.GetEmail();
        var userId = User.GetUserId();
        if (string.IsNullOrWhiteSpace(email))
        {
            return Unauthorized();
        }

        var safeHistoryLimit = Math.Clamp(historyLimit, 1, 50);
        var claimPlan = GetPlanFromClaims();
        var fallbackPlan = await ResolvePlanFallbackAsync(userId, email, claimPlan);

        if (string.IsNullOrEmpty(StripeConfiguration.ApiKey))
        {
            return Ok(new
            {
                configured = false,
                plan = fallbackPlan,
                status = fallbackPlan == "pro" ? "active" : "none",
                cancelAtPeriodEnd = false,
                nextBillingDate = (DateTime?)null,
                customerId = (string?)null,
                history = Array.Empty<object>(),
                availablePlans = GetAvailablePlans()
            });
        }

        try
        {
            var customer = await ResolveCustomerAsync(email, userId);
            if (customer == null)
            {
                return Ok(new
                {
                    configured = true,
                    plan = fallbackPlan,
                    status = fallbackPlan == "pro" ? "active" : "none",
                    cancelAtPeriodEnd = false,
                    nextBillingDate = (DateTime?)null,
                    customerId = (string?)null,
                    history = Array.Empty<object>(),
                    availablePlans = GetAvailablePlans()
                });
            }

            var subscription = await GetLatestSubscriptionAsync(customer.Id);
            var invoices = await ListInvoicesAsync(customer.Id, safeHistoryLimit);

            var status = subscription?.Status ?? "none";
            var cancelAtPeriodEnd = subscription?.CancelAtPeriodEnd ?? false;
            var plan = DeterminePlan(subscription, fallbackPlan);
            var nextBillingDate = GetNextBillingDate(subscription);

            await UpsertUserBillingStateAsync(
                userId: userId,
                email: email,
                customerId: customer.Id,
                subscriptionId: subscription?.Id,
                status: status,
                cancelAtPeriodEnd: cancelAtPeriodEnd,
                currentPeriodEnd: nextBillingDate);

            var history = invoices.Select(invoice => new
            {
                invoiceId = invoice.Id,
                number = invoice.Number,
                date = invoice.StatusTransitions?.PaidAt ?? invoice.Created,
                periodEnd = invoice.PeriodEnd,
                amountPaid = invoice.AmountPaid,
                currency = invoice.Currency,
                status = invoice.Status,
                hostedInvoiceUrl = invoice.HostedInvoiceUrl,
                invoicePdf = invoice.InvoicePdf
            });

            return Ok(new
            {
                configured = true,
                plan,
                status,
                cancelAtPeriodEnd,
                nextBillingDate,
                customerId = customer.Id,
                history,
                availablePlans = GetAvailablePlans()
            });
        }
        catch (StripeException e)
        {
            _logger.LogError(e, "Stripe billing summary error");
            return BadRequest(new { error = e.Message });
        }
    }

    /// <summary>
    /// Create a Stripe Checkout session for subscription upgrade.
    /// </summary>
    [EnableRateLimiting("billing-write")]
    [HttpPost("checkout")]
    public async Task<IActionResult> CreateCheckoutSession([FromBody] CheckoutRequest request)
    {
        if (string.IsNullOrEmpty(StripeConfiguration.ApiKey))
        {
            return StatusCode(503, new { error = "Billing not configured" });
        }

        try
        {
            var userId = User.GetUserId();
            var email = User.GetEmail();

            if (!string.IsNullOrWhiteSpace(email) &&
                !string.IsNullOrWhiteSpace(request.Email) &&
                !string.Equals(email, request.Email, StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest(new { error = "Email does not match authenticated user." });
            }

            var customerEmail = email ?? request.Email;
            if (string.IsNullOrWhiteSpace(customerEmail))
            {
                return BadRequest(new { error = "Email is required." });
            }

            if (!TryResolveReturnUrl(
                    request.SuccessUrl,
                    "https://quant-platform.com/settings/billing?status=success",
                    out var successUrl,
                    out var successError))
            {
                return BadRequest(new { error = successError ?? "Invalid success URL." });
            }

            if (!TryResolveReturnUrl(
                    request.CancelUrl,
                    "https://quant-platform.com/settings/billing?status=cancel",
                    out var cancelUrl,
                    out var cancelError))
            {
                return BadRequest(new { error = cancelError ?? "Invalid cancel URL." });
            }

            var existingCustomer = await ResolveCustomerAsync(customerEmail, userId);

            var options = new SessionCreateOptions
            {
                Mode = "subscription",
                SuccessUrl = successUrl,
                CancelUrl = cancelUrl,
                LineItems = new List<SessionLineItemOptions>
                {
                    new SessionLineItemOptions
                    {
                        Quantity = 1,
                        PriceData = new SessionLineItemPriceDataOptions
                        {
                            Currency = ProCurrency,
                            UnitAmount = ProMonthlyPriceCents,
                            Recurring = new SessionLineItemPriceDataRecurringOptions
                            {
                                Interval = ProInterval,
                                IntervalCount = 1,
                            },
                            ProductData = new SessionLineItemPriceDataProductDataOptions
                            {
                                Name = "QuantPlatform Pro",
                            },
                        },
                    }
                },
                Metadata = new Dictionary<string, string>
                {
                    { "user_id", userId ?? "" },
                    { "plan", "pro" },
                    { "price_cents", ProMonthlyPriceCents.ToString() }
                }
            };

            if (existingCustomer != null)
            {
                options.Customer = existingCustomer.Id;
            }
            else
            {
                options.CustomerEmail = customerEmail;
            }

            var service = new SessionService();
            var session = await service.CreateAsync(options);

            await UpsertUserBillingStateAsync(
                userId: userId,
                email: customerEmail,
                customerId: existingCustomer?.Id ?? session.CustomerId,
                subscriptionId: null,
                status: null,
                cancelAtPeriodEnd: null,
                currentPeriodEnd: null);

            return Ok(new { sessionId = session.Id, url = session.Url });
        }
        catch (StripeException e)
        {
            _logger.LogError(e, "Stripe checkout error");
            return BadRequest(new { error = e.Message });
        }
    }

    /// <summary>
    /// Cancel the active subscription for the authenticated user.
    /// </summary>
    [EnableRateLimiting("billing-write")]
    [HttpPost("cancel")]
    public async Task<IActionResult> CancelSubscription([FromBody] CancelSubscriptionRequest? request)
    {
        if (string.IsNullOrEmpty(StripeConfiguration.ApiKey))
        {
            return StatusCode(503, new { error = "Billing not configured" });
        }

        var email = User.GetEmail();
        var userId = User.GetUserId();
        if (string.IsNullOrWhiteSpace(email))
        {
            return Unauthorized();
        }

        try
        {
            var customer = await ResolveCustomerAsync(email, userId);
            if (customer == null)
            {
                return NotFound(new { error = "No billing customer found for this account." });
            }

            var subscription = await GetCancelableSubscriptionAsync(customer.Id);
            if (subscription == null)
            {
                return NotFound(new { error = "No active subscription to cancel." });
            }

            var subscriptionService = new SubscriptionService();
            var immediate = request?.Immediate ?? false;

            Subscription updated;
            if (immediate)
            {
                updated = await subscriptionService.CancelAsync(subscription.Id, new SubscriptionCancelOptions
                {
                    InvoiceNow = false,
                    Prorate = false
                });
            }
            else
            {
                updated = await subscriptionService.UpdateAsync(subscription.Id, new SubscriptionUpdateOptions
                {
                    CancelAtPeriodEnd = true
                });
            }

            await UpsertUserBillingStateAsync(
                userId: userId,
                email: email,
                customerId: customer.Id,
                subscriptionId: updated.Id,
                status: updated.Status,
                cancelAtPeriodEnd: updated.CancelAtPeriodEnd,
                currentPeriodEnd: GetNextBillingDate(updated));

            return Ok(new
            {
                subscriptionId = updated.Id,
                status = updated.Status,
                cancelAtPeriodEnd = updated.CancelAtPeriodEnd,
                nextBillingDate = GetNextBillingDate(updated)
            });
        }
        catch (StripeException e)
        {
            _logger.LogError(e, "Stripe cancellation error");
            return BadRequest(new { error = e.Message });
        }
    }

    /// <summary>
    /// Create customer portal session for managing subscription.
    /// </summary>
    [EnableRateLimiting("billing-write")]
    [HttpPost("portal")]
    public async Task<IActionResult> CreatePortalSession([FromBody] PortalRequest request)
    {
        if (string.IsNullOrEmpty(StripeConfiguration.ApiKey))
        {
            return StatusCode(503, new { error = "Billing not configured" });
        }

        if (string.IsNullOrWhiteSpace(request.CustomerId))
        {
            return BadRequest(new { error = "CustomerId is required." });
        }

        try
        {
            var userId = User.GetUserId();
            var email = User.GetEmail();

            if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(email))
            {
                return Unauthorized();
            }

            var customerService = new CustomerService();
            Customer? customer;
            try
            {
                customer = await customerService.GetAsync(request.CustomerId);
            }
            catch (StripeException e)
            {
                _logger.LogError(e, "Stripe customer lookup failed");
                return BadRequest(new { error = "Invalid customer." });
            }

            if (customer == null)
            {
                return BadRequest(new { error = "Customer not found." });
            }

            var emailMatches = !string.IsNullOrWhiteSpace(customer.Email)
                && string.Equals(customer.Email, email, StringComparison.OrdinalIgnoreCase);

            var metadataMatches = customer.Metadata != null
                && customer.Metadata.TryGetValue("user_id", out var metadataUserId)
                && !string.IsNullOrWhiteSpace(metadataUserId)
                && string.Equals(metadataUserId, userId, StringComparison.OrdinalIgnoreCase);

            if (!emailMatches && !metadataMatches)
            {
                return Forbid();
            }

            var options = new Stripe.BillingPortal.SessionCreateOptions
            {
                Customer = request.CustomerId,
                ReturnUrl = request.ReturnUrl ?? "https://quant-platform.app/dashboard"
            };

            var service = new Stripe.BillingPortal.SessionService();
            var session = await service.CreateAsync(options);

            return Ok(new { url = session.Url });
        }
        catch (StripeException e)
        {
            _logger.LogError(e, "Stripe portal error");
            return BadRequest(new { error = e.Message });
        }
    }

    /// <summary>
    /// Handle Stripe webhooks.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting("billing-webhook")]
    [HttpPost("webhook")]
    public async Task<IActionResult> HandleWebhook()
    {
        var json = await new StreamReader(HttpContext.Request.Body).ReadToEndAsync();
        var webhookSecret = NormalizeConfigValue(_config["STRIPE_WEBHOOK_SECRET"])
            ?? NormalizeConfigValue(_config["Stripe:WebhookSecret"]);
        var signatureHeader = Request.Headers["Stripe-Signature"].ToString();

        if (string.IsNullOrWhiteSpace(webhookSecret))
        {
            _logger.LogError("Stripe webhook secret not configured");
            return StatusCode(503, new { error = "Webhook not configured" });
        }

        if (string.IsNullOrWhiteSpace(signatureHeader))
        {
            _logger.LogWarning("Stripe webhook missing signature header");
            return BadRequest(new { error = "Missing Stripe-Signature header" });
        }

        try
        {
            var stripeEvent = EventUtility.ConstructEvent(
                json,
                signatureHeader,
                webhookSecret
            );

            _logger.LogInformation("Webhook received: {EventType}", stripeEvent.Type);

            switch (stripeEvent.Type)
            {
                case "checkout.session.completed":
                    var session = stripeEvent.Data.Object as Session;
                    await HandleCheckoutCompleted(session!);
                    break;

                case "customer.subscription.updated":
                case "customer.subscription.deleted":
                    var subscription = stripeEvent.Data.Object as Subscription;
                    await HandleSubscriptionChange(subscription!);
                    break;

                case "invoice.payment_failed":
                    var invoice = stripeEvent.Data.Object as Invoice;
                    await HandlePaymentFailed(invoice!);
                    break;
            }

            return Ok();
        }
        catch (StripeException e)
        {
            _logger.LogError(e, "Webhook signature verification failed");
            return BadRequest(new { error = "Webhook signature verification failed" });
        }
        catch (Exception e)
        {
            _logger.LogError(e, "Webhook processing error");
            return BadRequest(new { error = "Webhook payload could not be processed" });
        }
    }

    private async Task<Customer?> ResolveCustomerAsync(string email, string? userId)
    {
        var customerService = new CustomerService();
        var customers = await customerService.ListAsync(new CustomerListOptions
        {
            Email = email,
            Limit = 20
        });

        if (customers.Data == null || customers.Data.Count == 0)
        {
            return null;
        }

        var ordered = customers.Data
            .OrderByDescending(c => c.Created)
            .ToList();

        if (!string.IsNullOrWhiteSpace(userId))
        {
            var metadataMatch = ordered.FirstOrDefault(c =>
                c.Metadata != null
                && c.Metadata.TryGetValue("user_id", out var metadataUserId)
                && !string.IsNullOrWhiteSpace(metadataUserId)
                && string.Equals(metadataUserId, userId, StringComparison.OrdinalIgnoreCase));

            if (metadataMatch != null)
            {
                return metadataMatch;
            }
        }

        return ordered.FirstOrDefault(c =>
            !string.IsNullOrWhiteSpace(c.Email)
            && string.Equals(c.Email, email, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<Subscription?> GetLatestSubscriptionAsync(string customerId)
    {
        var service = new SubscriptionService();
        var subscriptions = await service.ListAsync(new SubscriptionListOptions
        {
            Customer = customerId,
            Status = "all",
            Limit = 20
        });

        if (subscriptions.Data == null || subscriptions.Data.Count == 0)
        {
            return null;
        }

        var ordered = subscriptions.Data
            .OrderByDescending(s => s.Created)
            .ToList();

        return ordered.FirstOrDefault(s => IsProLikeStatus(s.Status) || s.CancelAtPeriodEnd)
            ?? ordered[0];
    }

    private async Task<Subscription?> GetCancelableSubscriptionAsync(string customerId)
    {
        var service = new SubscriptionService();
        var subscriptions = await service.ListAsync(new SubscriptionListOptions
        {
            Customer = customerId,
            Status = "all",
            Limit = 20
        });

        if (subscriptions.Data == null || subscriptions.Data.Count == 0)
        {
            return null;
        }

        return subscriptions.Data
            .OrderByDescending(s => s.Created)
            .FirstOrDefault(s => IsCancelableStatus(s.Status));
    }

    private async Task<List<Invoice>> ListInvoicesAsync(string customerId, int limit)
    {
        var service = new InvoiceService();
        var invoices = await service.ListAsync(new InvoiceListOptions
        {
            Customer = customerId,
            Limit = limit
        });

        return invoices.Data
            .OrderByDescending(i => i.Created)
            .ToList();
    }

    private static DateTime? GetNextBillingDate(Subscription? subscription)
    {
        if (subscription?.Items?.Data == null || subscription.Items.Data.Count == 0)
        {
            return null;
        }

        var dates = subscription.Items.Data
            .Select(item => item.CurrentPeriodEnd)
            .Where(date => date > DateTime.UnixEpoch)
            .OrderBy(date => date)
            .ToList();

        if (dates.Count == 0)
        {
            return null;
        }

        return dates[^1];
    }

    private static bool IsProLikeStatus(string? status)
    {
        if (string.IsNullOrWhiteSpace(status)) return false;
        return status is "active" or "trialing" or "past_due" or "unpaid" or "incomplete";
    }

    private static bool IsCancelableStatus(string? status)
    {
        if (string.IsNullOrWhiteSpace(status)) return false;
        return status is "active" or "trialing" or "past_due" or "unpaid" or "incomplete";
    }

    private string DeterminePlan(Subscription? subscription, string fallbackPlan)
    {
        if (subscription == null)
        {
            return fallbackPlan;
        }

        if (IsProLikeStatus(subscription.Status) || subscription.CancelAtPeriodEnd)
        {
            return "pro";
        }

        return "free";
    }

    private string GetPlanFromClaims()
    {
        return User.GetPlan();
    }

    private async Task HandleCheckoutCompleted(Session session)
    {
        if (session == null)
        {
            return;
        }

        var metadata = session.Metadata ?? new Dictionary<string, string>();
        var userId = metadata.GetValueOrDefault("user_id");
        var email = session.CustomerDetails?.Email ?? session.CustomerEmail;
        var customerId = session.CustomerId;
        var subscriptionId = session.SubscriptionId;

        _logger.LogInformation(
            "Checkout completed for user {UserId}, customer {CustomerId}, subscription {SubscriptionId}",
            userId,
            customerId,
            subscriptionId);

        await UpsertUserBillingStateAsync(
            userId: userId,
            email: email,
            customerId: customerId,
            subscriptionId: subscriptionId,
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodEnd: null);
    }

    private async Task HandleSubscriptionChange(Subscription subscription)
    {
        if (subscription == null)
        {
            return;
        }

        var nextBillingDate = GetNextBillingDate(subscription);
        _logger.LogInformation(
            "Subscription {SubId} for customer {CustomerId} status: {Status} cancelAtPeriodEnd: {CancelAtPeriodEnd}",
            subscription.Id,
            subscription.CustomerId,
            subscription.Status,
            subscription.CancelAtPeriodEnd);

        await UpsertUserBillingStateAsync(
            userId: null,
            email: null,
            customerId: subscription.CustomerId,
            subscriptionId: subscription.Id,
            status: subscription.Status,
            cancelAtPeriodEnd: subscription.CancelAtPeriodEnd,
            currentPeriodEnd: nextBillingDate);
    }

    private async Task HandlePaymentFailed(Invoice invoice)
    {
        if (invoice == null)
        {
            return;
        }

        _logger.LogWarning("Payment failed for customer {CustomerId}", invoice.CustomerId);

        await UpsertUserBillingStateAsync(
            userId: null,
            email: null,
            customerId: invoice.CustomerId,
            subscriptionId: null,
            status: "past_due",
            cancelAtPeriodEnd: null,
            currentPeriodEnd: null);
    }

    private async Task<string> ResolvePlanFallbackAsync(string? userId, string email, string claimPlan)
    {
        if (_db == null || string.Equals(claimPlan, "pro", StringComparison.OrdinalIgnoreCase))
        {
            return claimPlan;
        }

        var user = await FindUserForBillingAsync(
            userId: userId,
            email: email,
            customerId: null,
            subscriptionId: null,
            asNoTracking: true);

        if (user != null && string.Equals(user.Plan, "pro", StringComparison.OrdinalIgnoreCase))
        {
            return "pro";
        }

        return claimPlan;
    }

    private async Task UpsertUserBillingStateAsync(
        string? userId,
        string? email,
        string? customerId,
        string? subscriptionId,
        string? status,
        bool? cancelAtPeriodEnd,
        DateTime? currentPeriodEnd)
    {
        if (_db == null)
        {
            return;
        }

        var user = await ResolveOrCreateUserForBillingUpdateAsync(userId, email, customerId, subscriptionId);
        if (user == null)
        {
            _logger.LogWarning(
                "Billing event could not be mapped to a user. UserId={UserId}, Email={Email}, CustomerId={CustomerId}, SubscriptionId={SubscriptionId}",
                userId,
                email,
                customerId,
                subscriptionId);
            return;
        }

        var changed = false;
        var normalizedCustomerId = NormalizeConfigValue(customerId);
        var normalizedSubscriptionId = NormalizeConfigValue(subscriptionId);
        var normalizedStatus = NormalizeConfigValue(status)?.ToLowerInvariant();

        if (!string.IsNullOrWhiteSpace(normalizedCustomerId) &&
            !string.Equals(user.StripeCustomerId, normalizedCustomerId, StringComparison.Ordinal))
        {
            user.StripeCustomerId = normalizedCustomerId;
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(normalizedSubscriptionId) &&
            !string.Equals(user.StripeSubscriptionId, normalizedSubscriptionId, StringComparison.Ordinal))
        {
            user.StripeSubscriptionId = normalizedSubscriptionId;
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(normalizedStatus) &&
            !string.Equals(user.BillingStatus, normalizedStatus, StringComparison.Ordinal))
        {
            user.BillingStatus = normalizedStatus;
            changed = true;
        }

        if (cancelAtPeriodEnd.HasValue && user.CancelAtPeriodEnd != cancelAtPeriodEnd.Value)
        {
            user.CancelAtPeriodEnd = cancelAtPeriodEnd.Value;
            changed = true;
        }

        if (currentPeriodEnd.HasValue)
        {
            var normalizedCurrentPeriodEnd = EnsureUtc(currentPeriodEnd.Value);
            if (user.SubscriptionCurrentPeriodEnd != normalizedCurrentPeriodEnd)
            {
                user.SubscriptionCurrentPeriodEnd = normalizedCurrentPeriodEnd;
                changed = true;
            }
        }
        else if (string.Equals(normalizedStatus, "canceled", StringComparison.Ordinal))
        {
            if (user.SubscriptionCurrentPeriodEnd != null)
            {
                user.SubscriptionCurrentPeriodEnd = null;
                changed = true;
            }
        }

        var effectiveStatus = normalizedStatus ?? user.BillingStatus;
        var effectiveCancelAtPeriodEnd = cancelAtPeriodEnd ?? user.CancelAtPeriodEnd;
        var effectiveCurrentPeriodEnd = currentPeriodEnd.HasValue
            ? EnsureUtc(currentPeriodEnd.Value)
            : user.SubscriptionCurrentPeriodEnd;

        var computedPlan = DeterminePlanFromPersistedState(
            effectiveStatus,
            effectiveCancelAtPeriodEnd,
            effectiveCurrentPeriodEnd);

        if (!string.Equals(user.Plan, computedPlan, StringComparison.Ordinal))
        {
            user.Plan = computedPlan;
            changed = true;
        }

        if (!changed)
        {
            return;
        }

        user.PlanUpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    private async Task<User?> ResolveOrCreateUserForBillingUpdateAsync(
        string? userId,
        string? email,
        string? customerId,
        string? subscriptionId)
    {
        if (_db == null)
        {
            return null;
        }

        var user = await FindUserForBillingAsync(userId, email, customerId, subscriptionId, asNoTracking: false);
        if (user != null)
        {
            return user;
        }

        var userGuid = UserIdentityResolver.ResolveUserGuid(userId, email);
        if (userGuid == null)
        {
            return null;
        }

        var safeEmail = BuildSafeEmailForBilling(userGuid.Value, email);
        var emailTaken = await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id != userGuid.Value && u.Email == safeEmail);
        if (emailTaken)
        {
            safeEmail = BuildFallbackEmailForBilling(userGuid.Value);
        }

        var created = new User
        {
            Id = userGuid.Value,
            Email = safeEmail,
            DisplayName = string.Empty,
            Plan = "free",
            CreatedAt = DateTime.UtcNow
        };

        _db.Users.Add(created);
        return created;
    }

    private async Task<User?> FindUserForBillingAsync(
        string? userId,
        string? email,
        string? customerId,
        string? subscriptionId,
        bool asNoTracking)
    {
        if (_db == null)
        {
            return null;
        }

        IQueryable<User> users = _db.Users;
        if (asNoTracking)
        {
            users = users.AsNoTracking();
        }

        var resolvedUserGuid = UserIdentityResolver.ResolveUserGuid(userId, email);
        if (resolvedUserGuid != null)
        {
            var byId = await users.FirstOrDefaultAsync(u => u.Id == resolvedUserGuid.Value);
            if (byId != null)
            {
                return byId;
            }
        }

        var normalizedCustomerId = NormalizeConfigValue(customerId);
        if (!string.IsNullOrWhiteSpace(normalizedCustomerId))
        {
            var byCustomer = await users.FirstOrDefaultAsync(u => u.StripeCustomerId == normalizedCustomerId);
            if (byCustomer != null)
            {
                return byCustomer;
            }
        }

        var normalizedSubscriptionId = NormalizeConfigValue(subscriptionId);
        if (!string.IsNullOrWhiteSpace(normalizedSubscriptionId))
        {
            var bySubscription = await users.FirstOrDefaultAsync(u => u.StripeSubscriptionId == normalizedSubscriptionId);
            if (bySubscription != null)
            {
                return bySubscription;
            }
        }

        var normalizedEmail = NormalizeEmailForBilling(email);
        if (!string.IsNullOrWhiteSpace(normalizedEmail))
        {
            return await users.FirstOrDefaultAsync(u => u.Email == normalizedEmail);
        }

        return null;
    }

    private static string DeterminePlanFromPersistedState(
        string? status,
        bool cancelAtPeriodEnd,
        DateTime? currentPeriodEnd)
    {
        if (IsProLikeStatus(status))
        {
            return "pro";
        }

        if (cancelAtPeriodEnd && currentPeriodEnd.HasValue && EnsureUtc(currentPeriodEnd.Value) > DateTime.UtcNow)
        {
            return "pro";
        }

        return "free";
    }

    private static string BuildSafeEmailForBilling(Guid userId, string? email)
    {
        var normalized = NormalizeEmailForBilling(email);
        return string.IsNullOrWhiteSpace(normalized)
            ? BuildFallbackEmailForBilling(userId)
            : normalized;
    }

    private static string BuildFallbackEmailForBilling(Guid userId)
    {
        return $"user-{userId:N}@quant-platform.local";
    }

    private static string? NormalizeEmailForBilling(string? email)
    {
        return UserIdentityResolver.NormalizeEmail(email);
    }

    private static DateTime EnsureUtc(DateTime value)
    {
        return value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };
    }

    private bool TryResolveReturnUrl(
        string? candidate,
        string fallback,
        out string resolved,
        out string? error)
    {
        error = null;

        if (string.IsNullOrWhiteSpace(candidate))
        {
            resolved = fallback;
            return true;
        }

        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri))
        {
            resolved = fallback;
            error = "Return URL must be an absolute URL.";
            return false;
        }

        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase))
        {
            resolved = fallback;
            error = "Return URL must use http or https.";
            return false;
        }

        if (!IsAllowedReturnHost(uri.Host))
        {
            resolved = fallback;
            error = "Return URL host is not allowed.";
            return false;
        }

        resolved = uri.ToString();
        return true;
    }

    private bool IsAllowedReturnHost(string host)
    {
        if (DefaultAllowedReturnHosts.Contains(host))
        {
            return true;
        }

        var configuredHosts = _config["BILLING_ALLOWED_RETURN_HOSTS"];
        if (!string.IsNullOrWhiteSpace(configuredHosts))
        {
            var allowed = configuredHosts
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (allowed.Contains(host, StringComparer.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        var requestHost = Request.Host.Host;
        if (!string.IsNullOrWhiteSpace(requestHost) &&
            string.Equals(requestHost, host, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return host.EndsWith(".quant-platform.com", StringComparison.OrdinalIgnoreCase);
    }

    private static object[] GetAvailablePlans() =>
    [
        new
        {
            code = "free",
            name = "Free",
            amountCents = 0L,
            currency = ProCurrency,
            interval = (string?)null
        },
        new
        {
            code = "pro",
            name = "Pro",
            amountCents = ProMonthlyPriceCents,
            currency = ProCurrency,
            interval = ProInterval
        }
    ];

    private static string? NormalizeConfigValue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return string.Equals(trimmed, "REPLACE_ME", StringComparison.OrdinalIgnoreCase)
            ? null
            : trimmed;
    }
}

public class CheckoutRequest
{
    [EmailAddress]
    [MaxLength(254)]
    public string? Email { get; set; }

    [StringLength(128)]
    public string? UserId { get; set; }

    // Kept for backwards compatibility with older clients; server ignores it
    // and always creates the fixed Pro monthly line item ($2.99).
    [StringLength(128)]
    public string? PriceId { get; set; }

    [Url]
    [MaxLength(2048)]
    public string? SuccessUrl { get; set; }

    [Url]
    [MaxLength(2048)]
    public string? CancelUrl { get; set; }
}

public class PortalRequest
{
    [Required]
    [StringLength(128)]
    public string CustomerId { get; set; } = "";

    [Url]
    [MaxLength(2048)]
    public string? ReturnUrl { get; set; }
}

public class CancelSubscriptionRequest
{
    public bool Immediate { get; set; } = false;
}
