---
layout: ../../layouts/DocsLayout.astro
title: Authentication
description: Cadence sign-in methods (local, magic link, GitHub/Google/Microsoft OAuth) and how to configure providers without committing secrets.
---

# Authentication & identity

Cadence uses **ASP.NET Core Identity** (in `Cadence.Api`, backed by Postgres via
EF Core in `Cadence.Data`) for accounts. This page mirrors
[`docs/auth-setup.md`](https://github.com/IEvangelist/cadence/blob/main/docs/auth-setup.md) —
see it for the full security rationale.

## Sign-in methods

| Method | How it works |
|---|---|
| **Local** email + password | `POST /api/auth/register`, `POST /api/auth/login` |
| **Passwordless magic link** | `POST /api/auth/magic-link` emails a single-use link → `GET /api/auth/magic-link/verify` |
| **GitHub** OAuth | `GET /api/auth/external/GitHub` → provider → callback |
| **Google** OAuth | `GET /api/auth/external/Google` |
| **Microsoft** OAuth | `GET /api/auth/external/Microsoft` |

Sessions are carried by a **hardened cookie** (`cadence.auth`): `HttpOnly`,
`SameSite=Lax`, and `Secure` everywhere except Development/Testing. The API answers
unauthorized requests with `401`/`403` **status codes** (never HTML redirects), so
the SPA can react. **No secrets are committed** — every external provider is off
until you supply its credentials locally.

## Provider configuration keys

External providers are **opt-in**: each registers only when *both* its `ClientId`
and `ClientSecret` are present. With the empty placeholders in `appsettings.json`,
the API runs with local + magic-link auth only, and `GET /api/auth/providers`
returns an empty list (so the SPA hides the buttons).

```
Authentication:Web:BaseUrl            # SPA origin used to build magic-link + redirect URLs
Authentication:GitHub:ClientId
Authentication:GitHub:ClientSecret
Authentication:Google:ClientId
Authentication:Google:ClientSecret
Authentication:Microsoft:ClientId
Authentication:Microsoft:ClientSecret
```

### Supplying secrets locally (user-secrets)

Never put real secrets in `appsettings.json`. Use the .NET **user-secrets** store,
kept outside the repo:

```bash
cd src/Cadence.Api
dotnet user-secrets init            # once
dotnet user-secrets set "Authentication:GitHub:ClientId"     "<id>"
dotnet user-secrets set "Authentication:GitHub:ClientSecret" "<secret>"
```

When running through `Cadence.AppHost`, the same keys can be supplied as
[Aspire parameters](https://learn.microsoft.com/dotnet/aspire/fundamentals/external-parameters)
and passed to the API as environment variables using the double-underscore
convention (`Authentication__GitHub__ClientId`). Keep parameter *values* in the
AppHost's own user-secrets — never in source.

## Registering the OAuth apps

Create an OAuth app with each provider and set its **callback URL** to
`{API origin}/signin-{provider}`:

| Provider | Where to register | Callback URL |
|---|---|---|
| GitHub | Settings → Developer settings → OAuth Apps | `https://localhost:<api-port>/signin-github` |
| Google | Google Cloud Console → Credentials → OAuth client ID | `https://localhost:<api-port>/signin-google` |
| Microsoft | Entra ID → App registrations | `https://localhost:<api-port>/signin-microsoft` |

The API port is assigned by Aspire — check the AppHost dashboard. In production,
swap `https://localhost:<api-port>` for the deployed API origin.

## Magic-link delivery

The magic-link **sender is a seam** (`IMagicLinkSender`). The default
`LoggingMagicLinkSender` writes the link to the logs — perfect for local dev and
integration tests, so **no email provider or secret** is required to try
passwordless sign-in. Wire a real transactional-email implementation by
registering it in `AddCadenceIdentity`.

Tokens are high-entropy, opaque values from a dedicated data-protector token
provider, embed a **15-minute expiry**, and are **single-use** (verifying rotates
the security stamp). The verify endpoint is throttled by a **per-email rate
limiter** (`429` when exceeded). The request endpoint always returns
`202 Accepted` whether or not the account exists, so it can't enumerate emails,
and it never creates an account for an unknown address.

## Profiles, tiers & the entitlement seam

Every account has a `UserProfile` and a **subscription tier** that defaults to
`Free`, surfaced as a claim by `TierClaimsPrincipalFactory` and checked through a
minimal `IEntitlementService` seam:

```csharp
bool HasEntitlement(ClaimsPrincipal user, string entitlement);
SubscriptionTier GetTier(ClaimsPrincipal user);
```

This is the seam **billing (effort #8) builds on**. The tier is now driven by a
real **Stripe-backed subscription lifecycle**, and the seam returns a **typed
entitlement set** per tier — enforced server-authoritatively on the API
(over-limit or paid-only actions return `402`). Free WAV exports carry a subtle
audible watermark; paid exports are byte-clean. See the repository's
[`billing-setup.md`](https://github.com/IEvangelist/cadence/blob/main/docs/billing-setup.md)
for the provider wiring, entitlements, and enforcement points, and
[Features](../features/) for the tier-by-tier capability map.

## Projects authorization model

Projects are **owned**: every `/api/projects` handler filters by the caller's user
id, so a user can only touch their **own** projects. Requesting another user's
project id returns `404` (not `403`, so the API doesn't leak existence). Rows use
a composite `{OwnerId, Id}` primary key, so a client-supplied id is unique
per user.
