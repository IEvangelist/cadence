using Microsoft.Extensions.Logging;

namespace Cadence.Api;

/// <summary>
/// Delivers magic-link sign-in emails. The default implementation logs the link
/// (development/CI); production wires a real transport (SMTP/SendGrid) via config.
/// Kept as a seam so no email provider or secret is required for the MVP.
/// </summary>
public interface IMagicLinkSender
{
    /// <summary>Send the sign-in link (and raw token) to the given address.</summary>
    Task SendMagicLinkAsync(string email, string link, string token, CancellationToken cancellationToken = default);
}

/// <summary>
/// Development/CI magic-link sender: logs the link instead of sending email. The
/// token is intentionally not logged at information level to avoid leaking it.
/// </summary>
public sealed class LoggingMagicLinkSender(ILogger<LoggingMagicLinkSender> logger) : IMagicLinkSender
{
    /// <inheritdoc />
    public Task SendMagicLinkAsync(string email, string link, string token, CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Magic-link sign-in requested for {Email}. Link generated.", email);
        logger.LogDebug("Magic-link for {Email}: {Link}", email, link);
        return Task.CompletedTask;
    }
}
