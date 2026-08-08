using Cadence.Api;

namespace Cadence.Api.Tests;

/// <summary>
/// Test double for <see cref="IMagicLinkSender"/> that records the most recent
/// link/token instead of sending email, so tests can drive the verify step.
/// </summary>
public sealed class CapturingMagicLinkSender : IMagicLinkSender
{
    /// <summary>The email the last magic link was requested for.</summary>
    public string? LastEmail { get; private set; }

    /// <summary>The last generated verification link.</summary>
    public string? LastLink { get; private set; }

    /// <summary>The last generated single-use token.</summary>
    public string? LastToken { get; private set; }

    /// <summary>Number of links actually sent (an existing account was found).</summary>
    public int SentCount { get; private set; }

    /// <inheritdoc />
    public Task SendMagicLinkAsync(string email, string link, string token, CancellationToken cancellationToken = default)
    {
        LastEmail = email;
        LastLink = link;
        LastToken = token;
        SentCount++;
        return Task.CompletedTask;
    }
}
