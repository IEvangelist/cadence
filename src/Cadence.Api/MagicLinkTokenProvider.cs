using Cadence.Data.Entities;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Cadence.Api;

/// <summary>
/// Options for <see cref="MagicLinkTokenProvider"/>. A magic link is meant to be
/// clicked promptly, so the token is short-lived; the embedded expiry is enforced
/// by the data-protection provider on verification.
/// </summary>
public sealed class MagicLinkTokenProviderOptions : DataProtectionTokenProviderOptions
{
    /// <summary>Create the options with the magic-link defaults.</summary>
    public MagicLinkTokenProviderOptions()
    {
        Name = "MagicLinkTokenProvider";
        TokenLifespan = TimeSpan.FromMinutes(15);
    }
}

/// <summary>
/// Produces opaque, high-entropy, single-use magic-link tokens.
/// <para>
/// Unlike <see cref="EmailTokenProvider{TUser}"/> (the default email provider),
/// whose tokens are 6-digit numeric TOTP codes that are feasible to brute-force,
/// this data-protector provider emits a cryptographically protected blob that also
/// carries a short embedded expiry and binds to the user's security stamp — so a
/// used token can be invalidated by rotating the stamp.
/// </para>
/// </summary>
public sealed class MagicLinkTokenProvider(
    IDataProtectionProvider dataProtectionProvider,
    IOptions<MagicLinkTokenProviderOptions> options,
    ILogger<MagicLinkTokenProvider> logger)
    : DataProtectorTokenProvider<ApplicationUser>(dataProtectionProvider, options, logger);
