using Microsoft.Extensions.Logging;

namespace Cadence.Api;

/// <summary>
/// Delivers the transactional account emails Cadence sends (magic-link sign-in,
/// registration verification, and the neutral "already registered" notice). The
/// default implementation logs instead of sending; production wires a real
/// transport (SMTP/SendGrid) via configuration. Kept as a single seam so no email
/// provider or secret is required for the MVP, and so every enumeration-sensitive
/// path funnels through one place.
/// </summary>
public interface IAccountEmailSender
{
    /// <summary>Send the passwordless sign-in link (and raw token) to the address.</summary>
    Task SendMagicLinkAsync(string email, string link, string token, CancellationToken cancellationToken = default);

    /// <summary>
    /// Send the "confirm your email to finish signing up" link to a brand-new
    /// registration. Sign-in only happens once this link is followed, so the
    /// registration response itself can stay neutral (see <c>RegisterAsync</c>).
    /// </summary>
    Task SendRegistrationVerificationAsync(string email, string link, string token, CancellationToken cancellationToken = default);

    /// <summary>
    /// Notify an address that a registration was attempted for an account that
    /// already exists (with a sign-in / password-reset nudge). This is the neutral
    /// counterpart to <see cref="SendRegistrationVerificationAsync"/>: it lets the
    /// register endpoint answer identically for new and existing emails while the
    /// real owner still finds out what happened out-of-band.
    /// </summary>
    Task SendAlreadyRegisteredAsync(string email, CancellationToken cancellationToken = default);
}

/// <summary>
/// Development/CI account-email sender: logs the action instead of sending email.
/// Tokens/links are only written at debug level to avoid leaking them.
/// </summary>
public sealed class LoggingAccountEmailSender(ILogger<LoggingAccountEmailSender> logger) : IAccountEmailSender
{
    /// <inheritdoc />
    public Task SendMagicLinkAsync(string email, string link, string token, CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Magic-link sign-in requested for {Email}. Link generated.", email);
        logger.LogDebug("Magic-link for {Email}: {Link}", email, link);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task SendRegistrationVerificationAsync(string email, string link, string token, CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Registration verification requested for {Email}. Link generated.", email);
        logger.LogDebug("Registration verification for {Email}: {Link}", email, link);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task SendAlreadyRegisteredAsync(string email, CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Registration attempted for existing account {Email}. Neutral notice generated.", email);
        return Task.CompletedTask;
    }
}
