# Authentication & identity setup

Cadence uses **ASP.NET Core Identity** (in `Cadence.Api`, backed by Postgres via
EF Core in `Cadence.Data`) for user accounts. Four sign-in methods are supported:

| Method | How it works |
|---|---|
| **Local** email + password | `POST /api/auth/register`, `POST /api/auth/login` |
| **Passwordless magic link** | `POST /api/auth/magic-link` emails a single-use link → `GET /api/auth/magic-link/verify` |
| **GitHub** OAuth | `GET /api/auth/external/GitHub` → provider → `GET /api/auth/external/callback` |
| **Google** OAuth | `GET /api/auth/external/Google` |
| **Microsoft** OAuth | `GET /api/auth/external/Microsoft` |

Sessions are carried by a **hardened cookie** (`cadence.auth`): `HttpOnly`,
`SameSite=Lax`, `Secure` when the request is HTTPS. The API answers unauthorized
requests with `401`/`403` status codes (never HTML redirects) so the SPA can
react. **No secrets are committed** — every provider is off until you supply its
credentials locally.

## Provider configuration keys

External providers are **opt-in**: each one only registers when *both* its
`ClientId` and `ClientSecret` are present. With the empty placeholders in
`appsettings.json`, the API runs with local + magic-link auth only, and
`GET /api/auth/providers` returns an empty list (so the SPA hides the buttons).

```
Authentication:Web:BaseUrl            # SPA origin used to build magic-link + redirect URLs
Authentication:GitHub:ClientId
Authentication:GitHub:ClientSecret
Authentication:Google:ClientId
Authentication:Google:ClientSecret
Authentication:Microsoft:ClientId
Authentication:Microsoft:ClientSecret
```

### Supplying secrets with user-secrets (local dev)

Never put real secrets in `appsettings.json`. Use the .NET **user-secrets** store
(kept outside the repo, in your user profile):

```bash
cd src/Cadence.Api
dotnet user-secrets init            # once
dotnet user-secrets set "Authentication:GitHub:ClientId"     "<id>"
dotnet user-secrets set "Authentication:GitHub:ClientSecret" "<secret>"
dotnet user-secrets set "Authentication:Google:ClientId"     "<id>"
dotnet user-secrets set "Authentication:Google:ClientSecret" "<secret>"
dotnet user-secrets set "Authentication:Microsoft:ClientId"     "<id>"
dotnet user-secrets set "Authentication:Microsoft:ClientSecret" "<secret>"
```

### Supplying secrets via Aspire parameters (orchestrated run)

When running through `Cadence.AppHost`, the same keys can be supplied as
[Aspire parameters](https://learn.microsoft.com/dotnet/aspire/fundamentals/external-parameters)
(which resolve from user-secrets / environment / key vault) and passed to the API
as environment variables using the double-underscore convention, e.g.
`Authentication__GitHub__ClientId`. Keep parameter *values* in the AppHost's own
user-secrets — never in `apphost.json` or source.

## Registering the OAuth apps

Create an OAuth app with each provider and set its **callback URL** to
`{API origin}/signin-{provider}` (the default path the middleware listens on):

| Provider | Where to register | Callback URL |
|---|---|---|
| GitHub | Settings → Developer settings → OAuth Apps | `https://localhost:<api-port>/signin-github` |
| Google | Google Cloud Console → Credentials → OAuth client ID | `https://localhost:<api-port>/signin-google` |
| Microsoft | Entra ID → App registrations | `https://localhost:<api-port>/signin-microsoft` |

The API port is assigned by Aspire; check the AppHost dashboard. In production,
swap `https://localhost:<api-port>` for the deployed API origin.

## Magic-link delivery

The magic-link **sender is a seam** (`IMagicLinkSender`). The default
`LoggingMagicLinkSender` writes the link to the logs — perfect for local dev and
integration tests, and it means no email provider or secret is required to try
passwordless sign-in. Wire a real transactional-email implementation (SendGrid,
Azure Communication Services, …) by registering it in `AddCadenceIdentity`.

Magic-link tokens are generated with Identity's `DefaultEmailProvider` and are
**single-use**: verifying one rotates the user's security stamp, invalidating it.
The request endpoint always returns `202 Accepted` whether or not the account
exists, so it can't be used to enumerate registered emails.

## Profiles, tiers & the entitlement seam

Every account has a `UserProfile` (display name, bio, avatar URL) created on
first sign-in and a **subscription tier** that defaults to `Free`. The tier is
surfaced as a claim by `TierClaimsPrincipalFactory` and checked through the
minimal `IEntitlementService` seam:

```csharp
// Cadence.Data/Entitlements/IEntitlementService.cs
bool HasEntitlement(ClaimsPrincipal user, string entitlement);
SubscriptionTier GetTier(ClaimsPrincipal user);
```

This is **scaffolding only** — there is no billing and no feature-gating yet.
Effort #8 plugs real entitlement rules into this seam without touching the auth
or persistence code.

## Data & migrations

`Cadence.Data` owns the EF Core model (`CadenceDbContext : IdentityDbContext`)
and the Npgsql migrations. The API applies pending migrations at startup against
the Aspire-wired Postgres database. To add a migration after changing an entity:

```bash
dotnet tool install --global dotnet-ef            # once, version 10.0.10
dotnet ef migrations add <Name> \
  --project src/Cadence.Data --startup-project src/Cadence.Api
```

## Related endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | anon | Create a local account and sign in |
| `POST /api/auth/login` | anon | Local sign in |
| `POST /api/auth/logout` | user | Sign out |
| `GET  /api/auth/me` | user | Current identity summary (id, email, display name, tier) |
| `POST /api/auth/magic-link` | anon | Request a passwordless sign-in link |
| `GET  /api/auth/magic-link/verify` | anon | Consume a link and sign in |
| `GET  /api/auth/external/{provider}` | anon | Start an OAuth challenge |
| `GET  /api/auth/external/callback` | anon | OAuth return leg |
| `GET  /api/auth/providers` | anon | Names of the wired external providers |
| `GET/PUT /api/profile` | user | Read / update the signed-in user's profile |
| `GET/POST/PUT/DELETE /api/projects` | user | Owner-scoped project CRUD (see below) |

### Projects authorization model

Projects are **owned**: every `/api/projects` handler filters by the caller's
user id, so a user can only list, read, update, or delete their **own** projects.
Requesting another user's project id returns `404 Not Found` (not `403`, so the
API doesn't leak the existence of other users' data). This is covered by an
integration test asserting user A cannot read or modify user B's project.
