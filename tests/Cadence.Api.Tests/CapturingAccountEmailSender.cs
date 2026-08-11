using Cadence.Api;

namespace Cadence.Api.Tests;

/// <summary>
/// Test double for <see cref="IAccountEmailSender"/> that records what would have
/// been sent instead of sending email, so tests can drive the verify steps and
/// assert on send behavior. Sends run on the background dispatcher, so tests should
/// await <see cref="CadenceApiFactory.WaitForEmailsAsync"/> before reading these.
/// </summary>
public sealed class CapturingAccountEmailSender : IAccountEmailSender
{
    private int _sentCount;
    private int _registrationVerificationCount;
    private int _alreadyRegisteredCount;

    /// <summary>The email the last magic link was requested for.</summary>
    public string? LastEmail { get; private set; }

    /// <summary>The last generated magic-link verification link.</summary>
    public string? LastLink { get; private set; }

    /// <summary>The last generated single-use magic-link token.</summary>
    public string? LastToken { get; private set; }

    /// <summary>Number of magic links actually sent (an existing account was found).</summary>
    public int SentCount => _sentCount;

    /// <summary>Number of registration-verification emails sent (new accounts).</summary>
    public int RegistrationVerificationCount => _registrationVerificationCount;

    /// <summary>The email the last registration-verification link was sent to.</summary>
    public string? LastRegistrationVerificationEmail { get; private set; }

    /// <summary>The last generated registration-verification link.</summary>
    public string? LastRegistrationVerificationLink { get; private set; }

    /// <summary>The last generated registration-verification token.</summary>
    public string? LastRegistrationVerificationToken { get; private set; }

    /// <summary>Number of "already registered" notices sent (existing accounts).</summary>
    public int AlreadyRegisteredCount => _alreadyRegisteredCount;

    /// <summary>The email the last "already registered" notice was sent to.</summary>
    public string? LastAlreadyRegisteredEmail { get; private set; }

    /// <inheritdoc />
    public Task SendMagicLinkAsync(string email, string link, string token, CancellationToken cancellationToken = default)
    {
        LastEmail = email;
        LastLink = link;
        LastToken = token;
        Interlocked.Increment(ref _sentCount);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task SendRegistrationVerificationAsync(string email, string link, string token, CancellationToken cancellationToken = default)
    {
        LastRegistrationVerificationEmail = email;
        LastRegistrationVerificationLink = link;
        LastRegistrationVerificationToken = token;
        Interlocked.Increment(ref _registrationVerificationCount);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task SendAlreadyRegisteredAsync(string email, CancellationToken cancellationToken = default)
    {
        LastAlreadyRegisteredEmail = email;
        Interlocked.Increment(ref _alreadyRegisteredCount);
        return Task.CompletedTask;
    }
}
