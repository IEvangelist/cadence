using Cadence.ServiceDefaults;
using Microsoft.AspNetCore.Http;

namespace Cadence.Api.Tests;

public class CadenceTelemetryClassificationTests
{
    [Theory]
    [InlineData("/api/auth/register", "POST", "auth", "register")]
    [InlineData("/api/auth/login", "POST", "auth", "login")]
    [InlineData("/api/auth/logout", "POST", "auth", "logout")]
    [InlineData("/api/auth/me", "GET", "auth", "me")]
    [InlineData("/api/auth/magic-link", "POST", "auth", "magic_link_request")]
    [InlineData("/api/auth/magic-link/verify", "GET", "auth", "magic_link_verify")]
    [InlineData("/api/auth/external/Google", "GET", "auth", "external_challenge")]
    [InlineData("/api/auth/external/callback", "GET", "auth", "external_callback")]
    [InlineData("/api/auth/providers", "GET", "auth", "providers")]
    [InlineData("/api/projects", "POST", "projects", "create")]
    [InlineData("/api/projects/", "GET", "projects", "list")]
    [InlineData("/api/projects/project-123", "GET", "projects", "get")]
    [InlineData("/api/projects/project-123", "PUT", "projects", "update")]
    [InlineData("/api/projects/project-123", "DELETE", "projects", "delete")]
    [InlineData("/api/billing/checkout", "POST", "billing", "checkout")]
    [InlineData("/api/billing/portal", "POST", "billing", "portal")]
    [InlineData("/api/billing/webhook", "POST", "billing", "webhook")]
    [InlineData("/api/entitlements", "GET", "billing", "entitlements")]
    public void Classify_ReturnsExpectedFlowAndOperation(
        string path,
        string httpMethod,
        string expectedFlow,
        string expectedOperation)
    {
        var result = CadenceTelemetry.Classify(new PathString(path), httpMethod);

        Assert.True(result.HasValue);
        Assert.Equal(expectedFlow, result.Value.Flow);
        Assert.Equal(expectedOperation, result.Value.Operation);
    }

    [Theory]
    [InlineData("/health")]
    [InlineData("/alive")]
    [InlineData("/api/info")]
    [InlineData("/openapi/v1.json")]
    [InlineData("/api/projects/project-123/children")]
    public void Classify_IgnoresNonCadenceFlows(string path)
    {
        var result = CadenceTelemetry.Classify(new PathString(path), HttpMethods.Get);

        Assert.Null(result);
    }

    [Theory]
    [InlineData(200, "success")]
    [InlineData(401, "unauthorized")]
    [InlineData(403, "unauthorized")]
    [InlineData(400, "invalid")]
    [InlineData(402, "payment_required")]
    [InlineData(422, "invalid")]
    [InlineData(429, "rate_limited")]
    [InlineData(500, "error")]
    [InlineData(418, "other")]
    public void OutcomeFor_ReturnsExpectedOutcome(int statusCode, string expectedOutcome)
    {
        Assert.Equal(expectedOutcome, CadenceTelemetry.OutcomeFor(statusCode));
    }
}
