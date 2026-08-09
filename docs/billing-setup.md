# Billing, entitlements & the free-tier watermark

Cadence's freemium model (issue #8) is built on three seams that plug into the
existing Identity/persistence layer (#7) **without duplicating auth**:

1. **Billing provider** — Stripe (test mode) for Checkout, the Customer Portal,
   and a signed webhook that maps subscription lifecycle events to a durable,
   owner-scoped subscription record.
2. **Entitlements** — a typed set of limits/flags resolved per **tier**
   (`Free` | `Pro`), enforced server-authoritatively on the API.
3. **Audio watermark** — a subtle, deterministic watermark applied to
   **free-tier** WAV exports; paid exports are byte-clean.

> **No secrets are committed.** Every Stripe key is a placeholder in
> `appsettings.json` and supplied locally via user-secrets / Aspire params. With
> the placeholders empty, billing endpoints degrade safely (see below) and the
> rest of the app runs normally.

## Tiers & entitlements

One **Free** and one **Pro** tier ship for the MVP. Adding a tier is a *config*
change, not a rewrite: extend `SubscriptionTier` and add an `EntitlementPlan`.

| Entitlement | Free (default) | Pro (default) |
|---|---|---|
| `WatermarkExports` | `true` | `false` |
| `MaxProjects` | `10` | `-1` (unlimited) |
| `AiGenerationsPerDay` | `50` | `-1` (unlimited) |
| `AdvancedFormats` (reserved #10) | `false` | `true` |
| `StemSeparation` (reserved #10) | `false` | `true` |
| `CollaborationSeats` | `1` | `5` |

Defaults live in `EntitlementOptions` and are **override-friendly** — bind any
subset from the `Billing:Entitlements` configuration section, e.g.:

```
Billing:Entitlements:Free:MaxProjects       # override just the free cap
Billing:Entitlements:Pro:CollaborationSeats
```

The tier is resolved from the **status → tier** mapping (`Active`/`Trialing` →
`Pro`; everything else → `Free`) and mirrored onto the user's profile, which is
the authoritative source read by the API and the tier claim.

### The entitlement seam

```csharp
// Cadence.Data/Entitlements/IEntitlementService.cs
SubscriptionTier GetTier(ClaimsPrincipal principal);          // coarse, claim-based hint
Entitlements     GetEntitlements(SubscriptionTier tier);       // typed, config-driven
Entitlements     GetEntitlements(ClaimsPrincipal principal);   // convenience overload
```

`Entitlements` is an immutable record; `MaxProjects`/`AiGenerationsPerDay` use
`-1` to mean **unlimited** (`Entitlements.Unlimited`).

## Enforcement points & status codes

Enforcement is **server-authoritative** — the API resolves the tier from
persistence (not from the cookie claim) before allowing a gated action. The
client gate is convenience only.

| Action | Rule | Response when blocked |
|---|---|---|
| `POST /api/projects` | Free capped at `MaxProjects`; Pro unlimited | **402** `application/problem+json`, `type=https://cadence.app/problems/upgrade-required` |
| `POST /api/billing/portal` | Paid-only (needs a Stripe customer) | **402** upgrade-required problem |
| `POST /api/billing/checkout` | Requires Stripe configured | **503** when billing isn't configured |
| `POST /api/billing/webhook` | Signature must verify | **400** invalid signature · **503** no signing secret |

`402 Payment Required` is used for "upgrade to continue" cases; the typed problem
body carries the `upgrade-required` type URI so the client can render an upgrade
CTA deterministically.

## API endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET  /api/entitlements` | user | Current tier + typed entitlements (DB-authoritative) |
| `POST /api/billing/checkout` | user | Start a Stripe Checkout session → `{ url }` |
| `POST /api/billing/portal` | user | Open the Customer Portal → `{ url }` (paid-only) |
| `POST /api/billing/webhook` | anon (signed) | Stripe lifecycle events → subscription record |

The current tier + entitlements are also exposed to the client via
`GET /api/entitlements` and mirrored in the auth cookie's tier claim, so the SPA
can reflect state without trusting the client for enforcement.

## Stripe configuration keys

Billing is **opt-in**: with empty keys the checkout/portal endpoints report
`503` and the webhook reports `503` (it refuses unsigned payloads). Supply:

```
Billing:Stripe:SecretKey        # sk_test_…  (server-side API calls)
Billing:Stripe:PublishableKey   # pk_test_…  (client, optional)
Billing:Stripe:WebhookSecret    # whsec_…    (verifies the webhook signature)
Billing:Stripe:PriceId          # price_…    (the Pro subscription price)
Billing:SuccessUrl              # optional; defaults to {web}/pricing?checkout=success
Billing:CancelUrl               # optional; defaults to {web}/pricing?checkout=cancel
Billing:PortalReturnUrl         # optional; defaults to {web}/pricing
```

`Billing:IsConfigured` is derived (`SecretKey` + `PriceId` present); webhook
verification is gated on `WebhookSecret`.

### Supplying secrets with user-secrets (local dev)

```bash
cd src/Cadence.Api
dotnet user-secrets set "Billing:Stripe:SecretKey"      "sk_test_…"
dotnet user-secrets set "Billing:Stripe:WebhookSecret"  "whsec_…"
dotnet user-secrets set "Billing:Stripe:PriceId"        "price_…"
```

### Supplying secrets via Aspire parameters (orchestrated run)

`Cadence.AppHost` forwards any present `Billing:*` values to the API as
double-underscore env vars (`Billing__Stripe__WebhookSecret`, …) — empty values
are **not** forwarded, so nothing is required for a local run. Keep the parameter
*values* in the AppHost's own user-secrets, never in `apphost.json` or source.

### Local webhook testing

Use the Stripe CLI to forward events and print a signing secret:

```bash
stripe listen --forward-to https://localhost:<api-port>/api/billing/webhook
# copy the whsec_… it prints into user-secrets as Billing:Stripe:WebhookSecret
stripe trigger customer.subscription.updated
```

Webhook handling is **idempotent**: each Stripe event id is recorded in a
`ProcessedBillingEvents` ledger, so a redelivered event causes exactly one state
change.

## Free-tier audio watermark

Free WAV exports carry a **subtle, deterministic spread-spectrum watermark**;
paid exports are **byte-identical** to the un-watermarked render. It is a
self-contained pure function applied at the **render → encode** boundary:

```ts
// apps/web/src/composer/formats/audioWatermark.ts
applyAudioWatermark(channels: Float32Array[], { enabled }): Float32Array[]
```

- **Subtle**: energy sits ~60 dB below full scale (`WATERMARK_SPEC.amplitude`).
- **Hard to remove**: pseudo-noise spread across the spectrum (not a single tone
  a notch filter could strip), keyed by a fixed seed so it is reproducible.
- **Gated purely on the entitlement flag** (`WatermarkExports`), wired in exactly
  one place (`renderProjectToWav`, `watermark` option, default `true` = safe).

> **Why client-side?** Audio is rendered in the browser (Tone.js offline render),
> so the watermark must live there too. The *flag* comes from the server's
> entitlements (`GET /api/entitlements`); the server stays authoritative for the
> tier, and the watermark is a convenience deterrent, not a DRM boundary.

**Rebase note for effort #12 (Plugin SDK / exporter registry):** the watermark is
deliberately isolated as a pure post-process on the rendered PCM buffer with **no**
dependency on exporter internals. When #12 refactors `composer/formats/*` into an
exporter registry, drop the single `applyAudioWatermark(...)` call onto whatever
render → encode seam exists at rebase time — no watermark logic is threaded
through the exporters.

## In-app pricing UI

The pricing/upgrade surface lives in its **own feature area**
(`apps/web/src/billing/`), deliberately outside the composer core so it never
collides with #12. It reads `GET /api/entitlements`, reflects the current tier,
starts Checkout (upgrade CTA), and links to the Customer Portal. It is
brand-token themed and axe-clean (see `e2e/pricing.spec.ts`). This is the in-app
view only — the marketing landing page is owned by #13.

## Data & migrations

Billing adds two owner-scoped entities to `CadenceDbContext`:

- `Subscription` (1:1 with the user; `UserId` PK) — Stripe customer/subscription
  ids, status, tier, current period end.
- `ProcessedBillingEvent` (`EventId` PK) — the webhook idempotency ledger.

The `AddBilling` migration creates both. Regenerate migrations from
`Cadence.Data` as described in [auth-setup.md](./auth-setup.md#data--migrations).

## Versioning

`Stripe.net` is pinned **exactly** via Central Package Management
(`Directory.Packages.props`) and captured in `src/Cadence.Api/packages.lock.json`
(locked-mode restore under CI). No new npm dependencies are introduced.
