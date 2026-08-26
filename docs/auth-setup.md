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
`SameSite=Lax` by default, and `Secure` in every environment except
Development/Testing (which are served over plain HTTP) — so the cookie is never
emitted in the clear, even behind a TLS-terminating proxy. The API answers
unauthorized requests with `401`/`403` status codes (never HTML redirects) so the
SPA can react. **No secrets are committed** — every provider is off until you
supply its credentials locally.

The cookie's `SameSite`/`Secure` topology is **configuration-driven** so hosting
the SPA cross-site (a different site than the API) is a deploy-time toggle, not a
code change — see [Cookie topology & cross-site hosting](#cookie-topology--cross-site-hosting).

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

## Cookie topology & cross-site hosting

Cadence runs **same-origin locally**: the SPA reaches the API through the Vite
proxy, so the default is `SameSite=Lax` with `Secure` derived from the environment.
A Pages SPA and an API on a different registrable domain are cross-site and must
use the `None` configuration below.

If the SPA is ever hosted **cross-site** (a genuinely different site from the API,
so the auth cookie rides on cross-site requests), flip a single setting — no code
change:

```
Auth:Cookie:SameSite     # Lax (default) | None | Strict
```

| Value | When | Secure |
|---|---|---|
| `Lax` *(default / unset)* | Same-origin, or the SPA reached through a same-site proxy. Preserves today's behavior exactly. | Environment-derived (`Always` outside Dev/Testing). |
| `None` | **Cross-site**: the cookie must flow on cross-site requests. | **Forced `Always` in every environment** — browsers silently drop a `SameSite=None` cookie that is not `Secure`, so this is non-negotiable and cannot be downgraded by config or environment. |
| `Strict` | Hardened same-site only (the cookie never rides a cross-site navigation). | Environment-derived. |

The value applies to **both** the application cookie (`cadence.auth`) and the
short-lived external-login cookie (`cadence.external`). Set it as a scalar (e.g.
the `Auth__Cookie__SameSite=None` environment variable, or an Aspire parameter)
alongside the matching CORS origins below.

> **`None` requires HTTPS end-to-end.** Because `Secure` is forced on, a
> `SameSite=None` cookie will not be set over plain HTTP — terminate TLS at (or
> ahead of) the API and keep the deployed origins `https://`.

### CORS for cross-site (already flexible)

CORS is independently configuration-driven via `Cors:AllowedOrigins` and is always
**credentialed with explicit origins** (never a wildcard, which browsers forbid
with credentials). Supply origins either as a JSON array or, for a single
environment variable, a comma/semicolon-separated string:

```
Cors:AllowedOrigins            # JSON array: [ "https://app.example" ]
Cors__AllowedOrigins           # scalar env var: https://app.example,https://preview.example
```

When unset it defaults to the public Pages origin (`https://ievangelist.github.io`).
For a cross-site deployment, list every browser origin that must reach the API here
and set `Auth:Cookie:SameSite=None` so the credentialed requests carry the cookie.

## Cross-site request forgery protection

Cookie-authenticated mutations use ASP.NET Core antiforgery protection:

1. An authenticated SPA calls `GET /api/auth/csrf` with
   `credentials: include`. The no-store response sets the opaque, `HttpOnly`
   `cadence.csrf` cookie and returns `{ "requestToken": "..." }`.
2. The SPA caches the request token in memory and sends it as `X-CSRF-TOKEN` on
   every authenticated `POST`, `PUT`, `PATCH`, and `DELETE`.
3. The API requires a valid cookie/header pair before the handler runs. Missing,
   invalid, or mismatched pairs return `400 application/problem+json` with type
   `https://cadence.app/problems/invalid-csrf-token`.

The antiforgery cookie deliberately uses the **same configured SameSite and
Secure policy as the auth cookie**; it is not hard-coded to `Lax`.
`Auth:Cookie:SameSite=None` therefore produces
`cadence.csrf; SameSite=None; Secure; HttpOnly`, allowing the pair to work from
the Pages SPA without making the cookie readable by JavaScript. CORS allows the
custom header only to explicit `Cors:AllowedOrigins`; a hostile origin cannot
read the token endpoint or pass preflight.

On the typed invalid-token response, the SPA discards its cached token, obtains a
new pair, and retries the same mutation **once**. It does not retry unrelated
`400`s, follow redirects carrying the token, send the token to non-API URLs, or
fall back to an unprotected request.

Public account entry points (`register`, `login`, and magic-link request/verify)
remain usable before a session exists. The Stripe webhook remains anonymous and
is authenticated by its Stripe signature. All authenticated mutations,
including logout, profile/project/share CRUD, billing, optional server-side AI,
and raw stem uploads, require antiforgery.

### Safe rollout for an existing self-host

Protection defaults to enforced. To avoid breaking a cached old SPA during a
multi-revision rollout:

1. Deploy the new API with `Security__Antiforgery__Enforced=false`. This exposes
   the token endpoint/cookie/header contract while logging invalid or missing
   tokens; keep this temporary exception narrowly time-boxed.
2. Deploy the new SPA, purge/invalidate its CDN cache, and verify that mutation
   preflights include `X-CSRF-TOKEN` and API logs no longer show report-only
   failures.
3. Set `Security__Antiforgery__Enforced=true` (or remove the override, since
   `true` is the default), deploy/restart every API replica, and verify a
   token-less authenticated mutation returns the typed `400`.

Do not set the temporary switch to `false` as a permanent compatibility mode.
Rollback must roll back both SPA and API, or return to step 1 only long enough to
redeploy a compatible SPA.

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

## Account email delivery

All account emails — magic-link sign-in links **and** registration verification
links — go through a single seam (`IAccountEmailSender`). The default
`LoggingAccountEmailSender` writes the link to the logs — perfect for local dev and
integration tests, and it means no email provider or secret is required to try
passwordless sign-in. Wire a real transactional-email implementation (SendGrid,
Azure Communication Services, …) by registering it in `AddCadenceIdentity`.

Sends are dispatched through a background queue (`IAccountEmailQueue` /
`AccountEmailDispatcher`) rather than awaited inline on the request thread. This
keeps the latency of the `register` and `magic-link` endpoints independent of
whether the address exists — closing a timing side-channel that would otherwise
leak account existence despite the neutral `202` responses.

Magic-link tokens are high-entropy, opaque values produced by a dedicated
**data-protector token provider** (`MagicLinkTokenProvider`) — deliberately *not*
Identity's `DefaultEmailProvider`, whose tokens are short numeric TOTP codes that
are feasible to brute-force. Each token embeds a short expiry (15 minutes) and is
**single-use**: verifying one rotates the user's security stamp, invalidating it.
The verify endpoint is throttled by a **per-email rate limiter** (normalized email
partition, `429` when the budget is exceeded), which is the volume control for the
(already infeasible) guessing of an opaque token.

A failed verify **does not** increment Identity's account-lockout counter. Because
the endpoint is an unauthenticated `GET`, feeding that shared counter would let an
attacker who merely knows a victim's email lock the victim out of *both* magic-link
and password sign-in — a denial-of-service lever that the opaque token + rate
limiter already make unnecessary. A **successful** magic-link sign-in, conversely,
resets the failed-attempt count (a legitimate recovery path) and rotates the stamp.

> **Rate-limit backing store:** when the API is wired to Redis (the AppHost's
> `redis` reference), the auth limiters — the per-email magic-link **send** cap
> (3/hour) and the per-IP throttles — keep their counters in Redis via atomic
> `INCR`/`PEXPIRE`, so a budget is **global across replicas** and survives a restart
> rather than resetting per instance (which under ACA autoscale would make the cap
> N× looser). If Redis is momentarily unreachable the security-sensitive **send**
> cap fails **closed** (deny), while the coarse per-IP throttles fail **open** so a
> Redis blip can't lock legitimate users out of sign-in. With no Redis reference
> (unit tests, minimal local runs) the limiters fall back to equivalent in-process
> counters, preserving current behavior.

> **Delivery note — link prefetching:** because the link is verified on `GET`,
> mail-security prefetchers (Outlook SafeLinks, AV scanners) may fetch the URL
> before the user clicks and, with single-use tokens, consume it so the real click
> fails. For the MVP the logging/dev sender makes this a non-issue; if you wire a
> real email sender and see prefetch-consumed tokens, switch to a POST-confirm
> landing page (render a page on `GET`, then `POST` the token to verify) so passive
> fetches don't burn the token.

The request endpoint always returns `202 Accepted` whether or not the account
exists, so it can't be used to enumerate registered emails. It **never creates an
account** for an unknown address — otherwise an unauthenticated caller could
mass-create accounts for arbitrary/victim emails (resource exhaustion, email
squatting) or pre-stage an account for an external-login hijack.

### Registration is neutral and verification-gated

`POST /api/auth/register` is **non-enumerating**: it returns an identical
`202 Accepted` — same status, same empty body, **no `Set-Cookie`** — whether the
address is new or already registered, so a caller can't tell the two apart.
Registration no longer signs the browser in. Instead the server emails a
verification link (through the seam above); the account is activated only when the
user follows it (`GET /api/auth/register/verify`), which then establishes the
session. When the address already exists, the same-shaped `202` is returned and a
"you already have an account" notice is emailed instead — again revealing nothing
to the caller.

### External-login account linking

When an OAuth sign-in has no existing linked login, Cadence links it to a local
account with the same email **only when both**: the provider asserts the email is
verified (the OIDC `email_verified` claim) **and** the local account's own email
is confirmed. Otherwise the user is redirected to an explicit, authenticated
linking step (`?auth=error&reason=link-required`). This blocks a pre-account
hijack where an attacker pre-registers the victim's address and waits for the
victim's provider sign-in to be silently linked to the attacker's account.

> **GitHub caveat:** GitHub's OAuth userinfo does not emit an `email_verified`
> claim, so a GitHub sign-in will not auto-link to a pre-existing local account —
> it requires the explicit linking step. New GitHub accounts are created normally.

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

This is the seam **effort #8 builds on**. The tier is now driven by a real
subscription lifecycle (Stripe) and the seam returns a **typed entitlement set**
per tier — see **[billing-setup.md](./billing-setup.md)** for the provider wiring,
entitlements, enforcement points, and the free-tier audio watermark.

## Data & migrations

`Cadence.Data` owns the EF Core model (`CadenceDbContext : IdentityDbContext`)
and the Npgsql migrations. The API applies pending migrations at startup against
the Aspire-wired Postgres database. To add a migration after changing an entity:

```bash
dotnet tool install --global dotnet-ef            # once, version 10.0.10
dotnet ef migrations add <Name> \
  --project src/Cadence.Data --startup-project src/Cadence.Data
```

The `Cadence.Data` project carries the EF Core **design-time** package and a
`CadenceDbContextFactory`, so migrations are generated from it directly (no live
database required). The API remains the runtime startup that applies them.

## Related endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | anon | Begin registration; emails a verification link (neutral `202`, no sign-in) |
| `GET  /api/auth/register/verify` | anon | Consume a registration link, activate the account, and sign in |
| `POST /api/auth/login` | anon | Local sign in |
| `POST /api/auth/logout` | user | Sign out |
| `GET  /api/auth/me` | user | Current identity summary (id, email, display name, tier) |
| `GET  /api/auth/csrf` | user | Issue the no-store antiforgery cookie/request-token pair |
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
API doesn't leak the existence of other users' data). Project rows use a
**composite `{OwnerId, Id}` primary key**, so a client-supplied project id is
unique *per user* — two users may hold the same id without collision, and the
create-time existence check is scoped to the owner (no cross-tenant existence
oracle). This is covered by an integration test asserting user A cannot read or
modify user B's project.
