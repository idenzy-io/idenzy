# PROJECT: Idenzy — Authentication Platform

> A managed authentication & user-management platform (Firebase Auth / Supabase Auth / Clerk category), delivered as a hosted service on Google Cloud, with first-class SDKs for every major web, mobile and game platform. **Design pillars: extreme security by default, five-minute setup, and the lowest per-MAU price in the market.**

Document status: Architecture & scope blueprint (September 2026). Name finalized: **Idenzy** (`idenzy.dev` for dev surfaces, `idenzy.io` for marketing/dashboard — register both, plus `idenzy.com` defensively).

**How to read this.** Sections 1–6 define the product, the security model, the cloud architecture and the economics. Sections 7–10 are normative about implementation: the stack is **TypeScript on Node.js** — NestJS on a Fastify HTTP adapter for every service, a **pnpm workspace monorepo** for the whole codebase, and **Nuxt (latest)** for the three front-end panels (admin, client, landing). They define the package layout, the mandatory class-based engineering model and the panel split, and they are binding rather than advisory.

---

## 0. TL;DR

| Topic | Decision |
|---|---|
| What we sell | Hosted auth API + hosted/embeddable UI + SDKs + dashboard. Customers never touch tokens, keys or crypto. |
| Free tier | 50,000 MAU/month free (matches Firebase, Supabase, and Clerk's Feb-2026 50K tier). |
| Paid | **$0.0025 per MAU** above 50K (flat, no tiers). Email/SMS/passwordless delivery is metered separately with a margin. |
| Core stack | **TypeScript (strict) · NestJS on Fastify · Node.js LTS** services on Cloud Run · Cloud SQL for PostgreSQL (HA) · Memorystore (Valkey/Redis) · Cloud KMS · Global HTTPS LB + Cloud Armor · Pub/Sub + Cloud Tasks · Terraform. |
| Codebase | **Single pnpm workspace monorepo**, split into publishable/internal packages under `@idenzy/*`; apps consume packages, packages never consume apps. |
| Code style | **Class-based throughout.** Abstract base classes, inheritance, interfaces, decorators and constructor DI are mandatory; free-floating functions and ad-hoc object literals are not the unit of composition (see §7). |
| Front end | **Nuxt (latest), three panels**: `landing` (**SSR**, public marketing + docs shell), `admin` (**SPA, no SSR** — internal operator console), `client` (**SPA, no SSR** — customer dashboard). |
| Token model | Asymmetric-signed (ES256) short-lived access tokens (default 5 min, configurable down to 60 s) + opaque rotating refresh tokens with reuse detection + server-side revocable sessions. Per-project signing keys in KMS. |
| Web security model | First-party HttpOnly cookies on the customer's own (sub)domain via CNAME; no tokens in `localStorage`. |
| Delivery | Provider-abstracted: AWS SES (email, primary), Twilio / AWS End User Messaging / regional SMS providers (SMS), WhatsApp as cheap OTP channel. Customers can bring their own provider. |
| Why we can be cheaper | Fully multi-tenant shared infrastructure (zero per-tenant fixed cost), Cloud Run scale-to-near-zero, aggressive caching, no marketing-email features, no per-tenant DB. |

---

## 1. Vision & Positioning

**Problem.** Every app needs sign-in. Today teams choose between:

- **Firebase Auth** — cheap and simple, but locked into Google's client model, weak session control, no custom email domains, primitive templates, and pricing that steps down only at huge scale.
- **Supabase Auth** — good value, open source, but tied to the Supabase Postgres project model; email/SMS require the customer to configure their own provider; MFA and SSO cost extra.
- **Clerk** — best developer experience and prebuilt UI, but the most expensive (≈ $0.02/MRU past the free tier) and JavaScript/Next.js-centric; other platforms are second-class.

**Our position:** *"Clerk-grade DX and security, Firebase-grade platform reach, cheaper than Supabase."*

Three promises we optimize every decision against:

1. **Secure by default.** A developer who accepts every default gets an architecture that passes a serious pen test. Insecure options don't exist or are clearly labeled "dangerous".
2. **Five-minute setup.** Create project → paste one line of config → sign-in works, including Google/Apple/GitHub OAuth, email, and passkeys.
3. **Cheapest honest price.** $0.0025/MAU flat, 50K free, transparent pass-through pricing for email/SMS.

---

## 2. Competitor Research: How They Actually Work

### 2.1 Firebase Authentication / Google Cloud Identity Platform

**Architecture**
- Client SDKs talk directly to Google's Identity Toolkit REST API (`identitytoolkit.googleapis.com`) and the Secure Token API.
- On sign-in the client receives an **ID token** (RS256 JWT, 1-hour lifetime) and a **refresh token** (long-lived, opaque). The client SDK auto-refreshes the ID token.
- Backends verify ID tokens offline with Google's public keys (JWKS, `kid` rotation) — no network round trip.
- Tokens live in the client (IndexedDB / Keychain / Keystore). Web sessions are client-side by default; "session cookies" for SSR require the Admin SDK to mint them server-side.
- Revocation: refresh tokens can be revoked; ID tokens remain valid until expiry unless the backend checks `checkRevoked` (a network call).
- Extensibility via "blocking functions" (Identity Platform) that run before sign-up / sign-in.
- Google/Apple/Facebook/etc. OAuth works with Google-managed shared OAuth apps for Google sign-in; others require customer-supplied credentials.
- Email templates: limited customization (subject, body text, sender name), custom SMTP optional; **custom sending domain requires DNS setup and is limited.**

**Pricing (2026)**
- Free: first 50,000 MAU (email, phone, anonymous, social).
- Then tiered: $0.0055 (50K–100K), $0.0046 (100K–1M), $0.0032 (1M–10M), $0.0025 (10M+).
- SAML/OIDC: 50 MAU free, then $0.015/MAU.
- SMS: per message, region-priced (≈ $0.01 US up to ≈ $0.46), 10/day free.

**Lessons for us**
- Offline JWT verification with JWKS is table stakes.
- Their weakest points: no first-party cookie model for web, coarse revocation, poor email customization, tiered pricing that only reaches $0.0025 at 10M MAU. **We start at $0.0025.**

### 2.2 Supabase Auth (the "Auth" server)

**Architecture**
- A single dedicated auth service in front of Postgres (`auth` schema: `users`, `identities`, `sessions`, `refresh_tokens`, `mfa_factors`, `flow_state`, `audit_log_entries`, …).
- Issues **JWT access tokens** (historically HS256 with a project-wide shared secret; since 2025 supports asymmetric signing keys with JWKS and key rotation) plus **refresh tokens** stored in DB with **rotation + reuse detection** ("refresh token families": reusing a revoked token invalidates the whole session).
- Access token default 1 hour, configurable ≥ 5 min.
- OAuth via server-side redirect flow (`/authorize` → provider → `/callback`) with PKCE for mobile/SSR; the customer supplies provider credentials.
- Email: customer configures SMTP (built-in SMTP is rate-limited to a handful of emails/hour and dev-only). Templates use a simple variable-substitution syntax (`{{ .ConfirmationURL }}`, `{{ .Token }}`), editable in the dashboard.
- SMS: customer configures Twilio / MessageBird / Vonage / Textlocal.
- Row Level Security (RLS) integration is the "moat" — the JWT's claims are usable inside Postgres policies.
- Auth Hooks (Postgres functions or HTTP) for customizing claims, password checks, send-email/send-SMS overrides.
- MFA: TOTP free; phone MFA and "Advanced MFA" paid add-on; SAML SSO on paid tiers at $0.015/SSO MAU.

**Pricing (2026)**
- Free: 50,000 MAU. Pro ($25/mo): 100,000 MAU included, then **$0.00325 per MAU**.
- Counts logins/active sessions per month, not stored users.

**Lessons for us**
- The Postgres-backed refresh-token-family model is simple, auditable and correct. We adopt it.
- Their email/SMS story ("bring your own SMTP") is a real pain point — **we offer a ready-to-use managed delivery layer with templates**.
- Hooks-style extensibility (HTTP webhooks that can block or modify) is worth copying.
- What makes their model correct is the schema and the token-family invariants, not the implementation. We enforce the same invariants in the database (constraints + RLS) as well as in application code, so correctness does not depend on any one service behaving.

### 2.3 Clerk

**Architecture**
- Two token architecture:
  - **Client token** (`__client` cookie, HttpOnly) is set on Clerk's **Frontend API (FAPI)** domain (e.g. `clerk.customer.com` CNAME). It's the long-lived source of truth for the session, contains an anti-fixation rotating value, and defines the session lifetime.
  - **Session token** — a **60-second RS256 JWT** — placed in a `__session` cookie on the customer's app domain by the JS SDK. Backends verify it offline via JWKS.
- The SDK refreshes the session token on a ~50-second interval in the background. On server-rendered requests with an expired token, Clerk middleware performs a "handshake" redirect through FAPI to mint a fresh one.
- Because the JWT lives only 60 s, a stolen JWT is nearly useless; revocation is effectively immediate (≤ 60 s). Price: a token-refresh request per user per minute — expensive at scale, which they pass on in the price.
- Prebuilt UI components (`<SignIn/>`, `<UserButton/>`, `<OrganizationSwitcher/>`), customizable via an "appearance" prop and theming.
- Organizations / B2B (roles, invitations, SAML) as first-class product.
- Session token is customizable with templates (custom claims).
- Backend API for server-side user management; webhooks (Svix) for user lifecycle.

**Pricing (2026)**
- Free tier raised to 50,000 "MRU" (monthly retained users — a user's first day is free, so drive-by sign-ups aren't billed) on Feb 5, 2026.
- Pro: $25/mo + **$0.02/MRU** beyond 50K. MFA, custom session duration, organizations cost extra.

**Lessons for us**
- The **FAPI-on-customer-CNAME** trick is the right way to get first-party HttpOnly cookies while still being a hosted service. We adopt it (`auth.customer.com` → our LB).
- 60-second tokens are the gold standard for revocation latency; but for our price point we make lifetime **configurable (60 s – 1 h, default 5 min)** and use a **revocation bloom/cache** to give fast revocation without a per-minute refresh storm.
- Prebuilt UI components are what makes "5-minute setup" real. We ship hosted pages first, embeddable components second.
- "First day free" MRU is smart billing; we adopt a similar rule (see §5).

### 2.4 Summary comparison

| | Firebase | Supabase | Clerk | **Us** |
|---|---|---|---|---|
| Free MAU | 50K | 50K | 50K (MRU) | **50K** |
| Paid per MAU | $0.0055 → $0.0025 | $0.00325 | $0.02 | **$0.0025 flat** |
| Access token lifetime | 60 min | 60 min | 60 s | **5 min default (60 s–60 min)** |
| Signing | RS256 | HS256 legacy / asym. | RS256 | **ES256 per project, KMS-backed, auto-rotate** |
| Web session storage | client storage | client storage (or cookie w/ SSR helpers) | first-party HttpOnly cookies | **first-party HttpOnly cookies (default)** |
| Refresh token rotation + reuse detection | partial | yes | yes (client token rotation) | **yes** |
| Managed email w/ custom domain | limited | BYO SMTP | yes | **yes (SES-backed, templates, custom domain)** |
| Managed SMS | yes (Google) | BYO | yes | **yes (multi-provider, cost caps, pumping protection)** |
| Passkeys | limited | yes (paid tiers) | yes (Pro) | **yes, free, promoted as default** |
| Prebuilt UI | FirebaseUI (aging) | Auth UI (community) | excellent | **hosted pages + components** |
| Platforms | very broad | JS-centric + Flutter/Swift/Kotlin | JS-centric + RN/Expo/Flutter (beta) | **broad, tiered, spec-driven** |
| Organizations / B2B | via custom claims | none | excellent | Phase 2 |

---

## 3. Product Scope

### 3.1 Authentication methods

| Method | Free tier | Notes |
|---|---|---|
| Email + password | ✅ | Argon2id, breached-password check, strength meter. Email delivery for verification/reset is metered (see §5). |
| OAuth / social (Google, Apple, GitHub, Microsoft, Facebook, Discord, X, Twitch, LinkedIn, GitLab, Bitbucket, Slack, Spotify, Notion, Figma, Kakao, LINE, Zoom, …) | ✅ | Authorization-code + PKCE only. **Pre-configured "instant" mode** for dev: our shared OAuth app so it works in 30 seconds; production requires the customer's own client credentials (a guided wizard with exact console screenshots per provider). |
| Passkeys / WebAuthn | ✅ | Promoted as the default passwordless method (zero delivery cost). |
| Anonymous / guest | ✅ | Upgradable to full accounts (games!). |
| Magic link / email OTP | 💲 | Metered per email sent. |
| SMS OTP / phone sign-in | 💲 | Metered per SMS at regional pass-through rate + margin. |
| WhatsApp OTP | 💲 | ~10× cheaper than SMS in most regions; offered as a channel. |
| TOTP MFA (authenticator app) | ✅ | |
| Passkey as MFA / step-up | ✅ | |
| SMS MFA | 💲 | |
| Recovery codes | ✅ | |
| OIDC generic provider | ✅ | |
| SAML / Enterprise SSO | 💲 (Phase 2) | Per-SSO-MAU price like competitors (~$0.01). |
| Custom token / server-minted sessions | ✅ | For migrating existing auth systems. |
| Native Sign in with Apple / Google (ID-token exchange) | ✅ | Critical for iOS/Android/Flutter/Unity. |

### 3.2 Platform features

- **Hosted auth pages** on `auth.customer.com` (branded, themable, localized, accessibility-audited).
- **Embeddable UI components** (web components + framework wrappers) for in-app flows.
- **Dashboard**: users, sessions, devices, audit log, providers, templates, domains, keys, webhooks, usage/billing, team members with roles, 2FA required for dashboard staff. Delivered as the `client` Nuxt panel (§10).
- **Internal operator console**: tenancy administration, abuse response, spend caps, provider routing, incident tooling. Delivered as the `admin` Nuxt panel (§10) — never exposed to customers.
- **Management API** (server-side): CRUD users, impersonation (audited), bulk import (Firebase/Supabase/Auth0/Clerk export formats + bcrypt/scrypt/argon2 hash import), export.
- **Webhooks** (HMAC-signed, retried, replay-safe) for `user.created`, `user.updated`, `session.created`, `email.bounced`, …
- **Hooks** (synchronous HTTP): before-sign-up, before-sign-in, customize-claims, send-email-override, send-sms-override.
- **Email template studio** (see §11).
- **Session & device management**: list/revoke sessions, "sign out everywhere", device names, geo, last seen.
- **Security center**: breached-password alerts, impossible-travel alerts, bot/attack dashboards, cost caps for SMS.
- **Localization**: UI, emails and SMS templates in 30+ languages, per-project overrides.
- **Migration tooling** from Firebase, Supabase, Auth0, Clerk, Cognito.

### 3.3 SDK matrix

Everything is built on one **public HTTP API + published OpenAPI spec + a formal "Session Protocol" document**. SDKs are thin, generated-then-hand-polished clients so behaviour is identical everywhere.

| Tier | Platforms | Notes |
|---|---|---|
| **Tier 1 (launch)** | JS core (`@idenzy/js`), React, Next.js (App Router + middleware helper), Vue, Nuxt, Svelte/SvelteKit, Flutter (Dart), iOS (Swift), Android (Kotlin), React Native / Expo | Full UI components + hooks/composables. |
| **Tier 2 (launch + 2–3 months)** | Angular, SolidJS, Astro, Remix, Unity (C#), Godot (GDScript + C#), Kotlin Multiplatform, Electron, Tauri, Capacitor | Core client + minimal UI where a UI toolkit exists. |
| **Server SDKs** | Node, Python, PHP, Ruby, Java/Kotlin, .NET, Rust, Deno/Bun, Cloudflare Workers | JWKS verification (cached), webhook verification, management API. Middleware for Express/Fastify/Hono/NestJS, Django/FastAPI, Laravel, Rails, Spring, ASP.NET. |
| **Edge/SSR helpers** | Next, Nuxt, SvelteKit, Remix, Astro | Cookie-based session reading without network calls. |

Every SDK follows the same lifecycle: `init(publishableKey) → signIn* → session events → getToken() → signOut()`; identical error codes; identical storage security rules (Keychain / Keystore / SecureStore / HttpOnly cookies).

Because our backend is now TypeScript, the **Node server SDK and the Nuxt/Next SSR helpers share the exact protocol types** exported by `@idenzy/protocol` (§8) — the same compiled definitions the server uses to validate requests. Non-TS SDKs are generated from the same OpenAPI document, so the JS advantage is convenience, never a behavioural divergence.

---

## 4. Security Architecture (the most important section)

Design principle: **the customer cannot make a security mistake by accident.** Defaults are strict, dangerous options require an explicit "I understand" toggle, and everything is documented against OWASP ASVS Level 2 (target L3 for the core).

### 4.1 Threat model (what we defend against)

1. Token theft via XSS in the customer's app.
2. Refresh-token replay / session hijacking.
3. Credential stuffing, password spraying, brute force.
4. Account enumeration & timing attacks.
5. OAuth attacks: CSRF, code injection, redirect manipulation, mix-up attacks, IdP account takeover via unverified email.
6. Magic-link pre-fetching by mail scanners; OTP phishing.
7. SMS pumping / toll fraud (a real financial risk for us).
8. Multi-tenant data leakage.
9. Insider / operator risk; key compromise.
10. Supply-chain attacks on SDKs — heightened on npm; see §7.6 for the dependency and publishing controls this stack requires.
11. Bots and abuse of the free tier.

### 4.2 Token & session model

```
┌────────────┐   sign-in    ┌─────────────────┐
│  Client    │ ───────────▶ │  Auth API       │
│ (SDK)      │ ◀─────────── │  NestJS/Fastify │
└────────────┘  session +   │  (Cloud Run)    │
      │         tokens      └─────────────────┘
      │                             │
      │                             ▼
      │                    sessions / refresh_tokens (Postgres)
      │                    signing keys (Cloud KMS, per project)
      ▼
  Customer backend verifies access token offline via JWKS
```

- **Server-side session record** for every login: `session_id`, user, device, IP, UA, created, last_active, expires (idle timeout + absolute lifetime, both configurable). Revocable individually or in bulk.
- **Access token**: JWT, **ES256** (P-256), signed with a **per-project key pair** stored in **Cloud KMS** (HSM protection level for paid tiers). Claims: `iss` (`https://auth.customer.com`), `sub`, `sid`, `aud` (project), `iat`, `exp`, `amr` (auth methods), `acr`, `fva` (factor verification age), custom claims from hooks. Default TTL **5 minutes**; customer configurable 60 s–60 min.
- **Refresh token**: 256-bit random, opaque, stored **hashed (SHA-256)**; **rotated on every use**; **family-based reuse detection** — using an already-rotated token revokes the whole family/session and emits a security event. Bound to session and (optionally) to a device key (DPoP-style binding for mobile; see below).
- **Revocation latency**: a small **revocation set** (session IDs revoked in the last `max_ttl`) is cached in Valkey and exposed via a signed, cacheable endpoint; server SDKs can optionally check it (cheap) so revocation is near-instant even with 5-minute tokens. Customers who want Clerk-style 60 s tokens just set TTL=60.
- **Key rotation**: automatic every 90 days (configurable), two keys published in JWKS during overlap, `kid` in headers, emergency rotation button. Keys never leave KMS; signing is a KMS `asymmetricSign` call (cached JWKS public part on our side; ~1–3 ms).
- **JWKS endpoint** per project: `https://auth.customer.com/.well-known/jwks.json` and OIDC discovery `/.well-known/openid-configuration` — we are a standards-compliant OIDC provider, so any off-the-shelf library verifies our tokens.

**Implementation note (crypto in Node).** All primitives come from `node:crypto` (WebCrypto/OpenSSL-backed) or KMS — never from a hand-rolled or unaudited userland package. Random values use `crypto.randomBytes`; comparisons use `crypto.timingSafeEqual`; Argon2id uses a native binding (`argon2`) pinned by digest. CPU-bound hashing runs on a bounded worker-thread pool (§9.6) so the event loop is never blocked by a password verification.

### 4.3 Web: first-party cookie model

- Customer maps `auth.customer.com` → CNAME to our global load balancer (Certificate Manager issues the TLS cert automatically via DNS authorization).
- Session cookie: `__Host-`-style, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` attribute leakage. Contains an opaque session reference (not the JWT).
- Access token is delivered to the app's JS only in memory (never `localStorage`), or read server-side by SSR helpers from the cookie via the session exchange endpoint.
- **CSRF**: SameSite=Lax + double-submit token for state-changing endpoints + Origin/Fetch-Metadata checks.
- Cross-subdomain and cross-origin SPA setups are supported through a documented "token in Authorization header" mode — labeled and with strict CORS allowlists.
- Strict **Content-Security-Policy** and Trusted Types on hosted pages; no third-party scripts on auth pages.

### 4.4 Mobile & desktop

- Tokens in **Keychain (iOS, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`)** / **Android Keystore-encrypted storage** / Expo SecureStore / Unity & Godot via platform-native plugins (fallback: encrypted file with OS-provided key).
- OAuth via **ASWebAuthenticationSession / Custom Tabs** with **PKCE**; never WebViews.
- **Native Sign in with Apple / Google** → ID-token exchange endpoint (verifies nonce, audience, issuer).
- **App attestation** (App Attest / Play Integrity) optional gate for sensitive endpoints (sign-up, SMS send) — massively reduces SMS pumping and bot sign-ups on mobile.
- Optional **device-bound refresh tokens**: SDK generates a key pair in Secure Enclave/Keystore; refresh requests are signed (proof-of-possession). A stolen refresh token without the device key is useless.
- Universal links / App Links for magic links and OAuth returns.

### 4.5 Passwords & credentials

- **Argon2id** (memory 64 MB, t=3, p=1; tuned per hardware, versioned in the hash so we can upgrade transparently), pepper stored in KMS.
- **Breached-password check** at sign-up/reset via HIBP k-anonymity range API (only 5 hex chars leave our system).
- Min length 8, max 256, no composition rules (NIST 800-63B); Unicode normalization.
- Per-account and per-IP adaptive rate limiting; exponential backoff; **no account lockout by default** (prevents denial-of-service on victims); optional lockout with self-unlock via email.
- Constant-time comparisons; identical responses for "user not found" and "wrong password"; identical timing via dummy hash on missing users.
- Password reset: single-use, 15-minute, hashed token; invalidates all other reset tokens; optional "sign out other sessions on reset".
- Email change requires re-authentication (recent `fva`) and confirmation on **both** old and new address.

### 4.6 OAuth / social sign-in hardening

- Authorization code + PKCE (S256) always; `state` bound to the client session; `nonce` for OIDC; exact-match redirect URI allowlist per project (no wildcards except explicit dev-mode `localhost`).
- Provider-issuer validation prevents mix-up attacks.
- **Account linking rules**: auto-link only when the provider asserts `email_verified=true`; otherwise require proof via email OTP. Configurable per project (this single rule prevents the most common IdP-based account takeover).
- Provider access/refresh tokens stored encrypted (envelope encryption, KMS-wrapped DEK per project) and only if the customer opts in ("I need the provider token").
- "Instant dev mode" shared OAuth apps: only allowed for `localhost` and `*.idenzy.dev` preview domains; consent screen shows our brand; blocked for production custom domains.

### 4.7 Email links, OTPs & passwordless

- Magic links contain a **single-use, hashed, 10-minute token**; the link opens a **confirmation page that requires a click** (defeats corporate link scanners pre-consuming links) — or use **6/8-digit email OTP** entered on the same device (default for the highest phishing resistance and no cross-device confusion).
- OTPs: cryptographically random, hashed at rest, max 5 attempts, 10-minute expiry, bound to the originating flow/session.
- Sender authentication: SPF, DKIM (2048-bit), DMARC `p=reject` on our shared domains; customer domains guided to the same.
- Passkeys: full WebAuthn L3, resident keys, user verification required for password-less, attestation optional, conditional UI (autofill) on web.

### 4.8 SMS abuse & fraud (protects our margin)

- SMS only after **CAPTCHA/attestation** (reCAPTCHA Enterprise or Turnstile on web; App Attest / Play Integrity on mobile).
- Per-project **country allowlist** (default: customer's home region + explicit opt-in per country), per-number velocity limits, per-IP limits, per-project **daily spend cap** with alerts and hard stop.
- Pumping detection: burst of sequential numbers, same carrier prefix, high send/verify ratio → automatic throttle, alert, and provider-side fraud guard where available.
- Prefer WhatsApp / voice fallback in high-cost regions.

### 4.9 Bot & abuse protection

- Cloud Armor WAF (OWASP preconfigured rules), rate-limit rules at the edge (per IP, per project), adaptive protection for L7 DDoS.
- Application-level rate limits in Valkey: per identifier, per IP, per project, per endpoint.
- Free-tier abuse: project verification (email + phone for creator), quota on projects per account, anomaly detection on MAU spikes.
- Impossible-travel and new-device signals → optional step-up MFA or email notification ("new sign-in from…").

### 4.10 Multi-tenancy & data isolation

- Single shared Postgres cluster with `project_id` on every row, enforced by **Postgres Row Level Security** at the DB layer (application connects with a role that sets `app.project_id` per request; policies deny cross-project reads even if application code has a bug).
- Per-project signing keys and per-project encryption DEKs: a compromise of one project's key exposes nothing else.
- Data residency: project pinned to a **region cell** (EU, US, Asia) at creation; cells are fully independent stacks.
- Deletion: hard delete with tombstones for audit; GDPR export/delete APIs.
- Tenant context propagation is a framework concern, not a developer concern: a NestJS request-scoped `TenantContext` provider sets `app.project_id` on the checked-out connection for the life of the request (§9.4). Repositories cannot be constructed without it.

### 4.11 Platform & operational security

- **Zero static credentials**: Workload Identity everywhere; no service-account keys; no long-lived API keys for staff.
- All secrets in Secret Manager; KMS with separation of duties (key admins ≠ key users); CMEK on Cloud SQL and storage.
- Immutable, signed container images (Binary Authorization); SLSA-3 build provenance; SBOMs published.
- SDK packages signed (npm provenance, Sigstore, Apple/Android artifact signing); reproducible builds.
- Full **audit log** (who/what/when/IP) for every dashboard and management-API action, exported to the customer.
- Least-privilege VPC: Cloud SQL private IP only, Cloud Run with VPC egress via Serverless VPC connector/Direct VPC, no public DB.
- Secure SDLC: SAST/DAST in CI, dependency scanning, mandatory code review, threat-model review for every new auth flow, annual third-party pen test, public bug bounty, security.txt.
- Compliance roadmap: SOC 2 Type II (year 1), ISO 27001, GDPR DPA, HIPAA BAA on enterprise.
- Incident response runbooks: key compromise (emergency rotation, mass session revoke), provider outage (failover), data breach (notification timelines).

### 4.12 Things we deliberately do **not** offer

- Implicit / hybrid OAuth flows, ROPC (password grant).
- Tokens in `localStorage` as a default.
- Non-expiring API tokens.
- HS256 with shared secrets (except as an explicit legacy-compat option for migrations, time-boxed).
- Security questions.

---

## 5. Pricing & Unit Economics

### 5.1 Price list

| Item | Price |
|---|---|
| MAU 0–50,000 | Free (every project, forever) |
| MAU above 50,000 | **$0.0025 / MAU** |
| MAU definition | A user who authenticated (sign-in, token refresh, or session exchange) at least once in the calendar month. **First-day-free**: a user created and never seen again after day 1 is not billed (Clerk's MRU idea). Anonymous users count only when upgraded. |
| Transactional email (verification, reset, magic link, OTP, security notices) | **$0.50 per 1,000** on our shared domain; custom sending domain: $5/mo/domain + $0.40 per 1,000. BYO SES/SMTP: free. (Our cost: SES $0.10/1,000.) |
| SMS OTP | Regional wholesale cost + **25% margin**, rounded (e.g. US ≈ $0.012, TR/IN/DE per provider table). Displayed transparently per country in the dashboard. BYO Twilio/Vonage: free. |
| WhatsApp OTP | Meta authentication-template rate + 25%. |
| Enterprise SSO (SAML/OIDC) | $0.01 / SSO MAU (Phase 2) |
| Extra: dedicated region cell, HIPAA, SLA 99.99%, SSO for dashboard | Enterprise contract |

No "Pro plan required for MFA/passkeys/custom domains" gates. Security features are free — gating security is how competitors end up with insecure customers.

### 5.2 Why $0.0025 is viable

Revenue at scale (paid MAU only): 100K MAU → $125/mo; 500K → $1,125; 1M → $2,375; 5M → $12,375.

The economics only work if **marginal infrastructure cost per MAU is < ~$0.0008** and **fixed cost per tenant ≈ 0**. Assumptions per MAU/month: ~8 sign-ins, ~150 token refreshes (5-min TTL, ~12 h of active use), ~2 emails. That's ≈ 160 lightweight requests/MAU/month.

| Scale | Requests/mo | Cloud Run (Node/Fastify) | Cloud SQL | Valkey | LB/Armor/egress | Total |
|---|---|---|---|---|---|---|
| Launch (≤ 50K MAU total) | ~10M | $55 (min-instance 1) | $60 (db-custom-1-3840) | $35 (1 GB basic) | $40 | **~$190/mo** |
| 500K MAU | 80M | $200 | $250 (2 vCPU HA) | $70 | $120 | **~$640/mo** (vs $1,125 rev) |
| 5M MAU | 800M | $1,150 | $900 (8 vCPU HA + read replica) | $200 | $600 | **~$2,850/mo** (vs $12,375 rev) |

Gross margin still turns positive around ~250K paid MAU and exceeds 70% at scale. Free-tier projects cost us roughly $0.0002–0.0005 per MAU; the 50K free tier is a customer-acquisition cost, bounded by abuse controls.

**Note on compute sizing.** A Node.js service is memory-hungry relative to the work it does per request: allocate **1 GiB per instance**, not 512 MiB, and budget a moderate CPU cost per request. The compute lines above already reflect that. It moves blended cost by well under $0.0002/MAU — inside the headroom the $0.0025 price already carries — because compute is not the dominant line here; Cloud SQL and the load balancer are. The levers below keep it that way.

Cost levers that make this possible:
1. **Fastify, not Express** — the adapter choice is a cost decision, not a taste one: significantly higher throughput per vCPU on JSON workloads, and schema-compiled serialization that avoids the reflection cost most Node stacks pay per response.
2. Cloud Run concurrency **≥ 120 per instance** with an event-loop-friendly service: the hot paths (token refresh, session exchange) are I/O-bound, which is where Node is competitive with anything. CPU-bound work (Argon2, key wrapping) is pushed to a worker pool so it never serializes the loop (§9.6).
3. **Cache JWKS, project config, and rate-limit state** in Valkey; access-token verification never hits us; token refresh is one indexed Postgres update.
4. **Single shared HA Postgres** with RLS instead of per-tenant databases (Supabase's model forces a project per tenant — we don't).
5. Cloud CDN for hosted UI assets and JWKS (long cache with `kid` versioning). The `landing` panel's SSR output is CDN-cached at the edge so SSR cost is amortized across visitors, not paid per view (§10.3).
6. Async everything non-critical (email, webhooks, audit, analytics) via Pub/Sub so request latency and CPU stay low.
7. Cold-start discipline: services are bundled to a single JS file, dependency graph audited, no barrel-file mega-imports at boot, `NODE_OPTIONS` tuned, and lazy NestJS modules for rarely-used surfaces — this keeps min-instances low instead of paying for warm capacity.
8. No marketing-email product (SES handles our transactional needs at $0.10/1,000).

---

## 6. Google Cloud Architecture

### 6.1 Diagram

```
                     Internet / Customers' apps & SDKs
                                   │
                    ┌──────────────▼───────────────┐
                    │ Global External HTTPS LB      │  Certificate Manager (customer CNAMEs)
                    │ + Cloud Armor (WAF, rate lim) │  Cloud CDN (hosted UI, JWKS, SDK assets)
                    └──────┬───────────────┬────────┘
                           │               │
                ┌──────────▼───────┐  ┌────▼────────────────────┐
                │ auth-api         │  │ landing (Nuxt SSR)      │  Cloud Run
                │ NestJS + Fastify │  │ client / admin (Nuxt SPA)│ + CDN/static bucket
                │ (Cloud Run)      │  └─────────────────────────┘
                └──┬─────┬──────┬──┘
                   │     │      │
     ┌─────────────▼┐ ┌──▼────┐ ┌▼───────────────┐
     │ Cloud SQL PG │ │Valkey │ │ Cloud KMS      │
     │ HA, private  │ │(Memory│ │ per-project    │
     │ IP, PITR     │ │ store)│ │ signing keys   │
     └──────────────┘ └───────┘ └────────────────┘
                   │
        ┌──────────▼──────────┐          ┌──────────────────────┐
        │ Pub/Sub topics      │ ───────▶ │ workers (Cloud Run,   │ ──▶ AWS SES / Twilio / WhatsApp
        │ email, sms, webhook,│          │ NestJS standalone)    │ ──▶ customer webhook endpoints
        │ audit, analytics    │          │ email, sms, webhook,  │ ──▶ BigQuery (usage & billing)
        └─────────────────────┘          │ audit writer          │
                                         └──────────────────────┘
                                                Cloud Tasks (retries w/ backoff)
   Cross-cutting: Secret Manager · Cloud Logging/Monitoring · Uptime checks · Error Reporting
                  Cloud Build + Artifact Registry + Binary Authorization · Terraform · Cloud Scheduler
```

### 6.2 Component decisions & rationale

| Component | Choice | Why (cost / reliability) |
|---|---|---|
| Compute | **Cloud Run** (Gen 2), Node.js LTS, 1 vCPU / 1 GiB, min instances 1–2 in prod, 0 in staging | Cheapest managed compute with autoscaling, per-request billing, built-in TLS, revisions/rollbacks, no cluster to run. GKE only if we outgrow it (unlikely before 10M+ MAU). |
| Language | **TypeScript (strict) on Node.js LTS** | One language across API, workers, SDKs, dashboards and infra tooling — the single largest velocity lever for a small team, and it removes the protocol-drift class of bug between server and the JS SDKs that most of our customers use. Mature, audited JOSE (`jose`), WebAuthn (`@simplewebauthn/server`) and OIDC libraries; `node:crypto` for primitives. The cost is memory and raw CPU (§5.2) and a heavier supply-chain surface (§7.6) — both are managed, neither is structural. |
| HTTP framework | **NestJS with the Fastify adapter** | NestJS gives us the class-based, DI-driven, module-boundaried architecture this project requires (§7, §9) — guards, interceptors, pipes and filters map exactly onto our cross-cutting concerns (tenancy, rate limits, audit, error shaping). Fastify underneath gives the throughput and schema-based serialization Express cannot. |
| Database | **Cloud SQL for PostgreSQL 17**, regional HA, private IP, PITR, automated backups, managed connection pooling | Battle-tested, cheapest managed relational option with HA. Spanner/AlloyDB are overkill and 3–5× cost at our scale; migrate to AlloyDB only when write throughput demands. |
| DB access | **Postgres driver + a thin repository layer** (class-based, §9.4); SQL is written, not generated | We depend on RLS, `SET LOCAL app.project_id`, partitioning and precise index use — all things a heavyweight ORM obscures. Migrations are versioned SQL, applied by a dedicated job. |
| Cache / rate limits / OTP state | **Memorystore for Valkey** (1 GB basic at launch → standard HA) | Sub-ms counters, TTL primitives. At launch we could even use Postgres `UNLOGGED` tables to save $35/mo, but Valkey simplifies rate limiting. |
| Keys | **Cloud KMS** asymmetric EC P-256 keys (software level free tier / HSM for paid), one key ring per region, one key per project with rotation | Private keys never exist in app memory; signing audited via Cloud Audit Logs. |
| Edge | **Global external Application LB + Cloud Armor + Cloud CDN + Certificate Manager** | Single anycast IP for all customer CNAMEs, managed certs for thousands of custom domains, WAF and rate limiting before traffic costs us CPU. |
| Front end | **Nuxt (latest)** — `landing` SSR on Cloud Run, `admin` and `client` prerendered SPA shells on CDN/GCS (§10) | SSR only where SEO and first paint are the product (marketing/docs); the two authenticated panels are pure SPAs, which removes an entire class of server-side session handling and costs us nothing to serve. |
| Async | **Pub/Sub** + **Cloud Tasks** + Cloud Run workers | Cheap, at-least-once delivery, dead-letter topics, per-task retry with backoff for webhooks. |
| Analytics / billing | **BigQuery** (streaming inserts of `auth_event`), scheduled queries for MAU | Pay-per-query; MAU calculation = `COUNT(DISTINCT user_id)` per project per month. |
| Observability | Cloud Logging/Monitoring/Trace, OpenTelemetry (Node SDK, auto-instrumentation for Fastify/pg/Redis) in services, alerting to PagerDuty/Slack | Included; structured logs (Pino) with project_id for customer-facing log export. |
| IaC / CI | Terraform (google provider), Cloud Build → Artifact Registry → Cloud Deploy, Binary Authorization; pnpm workspace-aware build graph | Reproducible environments: dev / staging / prod-eu / prod-us. |
| Regions | Launch: one cell (`europe-west4` or `europe-west1`) with regional HA. Then `us-east1`/`us-central1`, `asia-southeast1`. Cell = independent Cloud Run + Cloud SQL + Valkey + KMS ring; control plane (dashboard/billing) is global. | Data residency, blast-radius isolation, simple pricing. |

### 6.3 Reliability targets

- 99.95% API availability at launch (single region, HA SQL, multi-zone Cloud Run), 99.99% once multi-cell with DNS/LB failover for the control plane.
- p95 latency: token refresh < 60 ms, sign-in < 250 ms (excluding provider round trips), JWKS from CDN < 20 ms.
- **Event-loop lag** is a first-class SLO: p99 < 20 ms per instance, alerting at 50 ms. A Node service that violates this is failing even while returning 200s, so it is monitored like an error rate, not like a nice-to-have.
- RPO ≤ 5 min (PITR), RTO ≤ 30 min (documented restore drill quarterly).
- Graceful degradation: if Valkey is down, fall back to Postgres rate limiting; if SES is down, fail over to secondary email provider automatically.

### 6.4 Infra cost at launch (single EU cell, prod)

| Item | Monthly |
|---|---|
| Cloud Run (auth-api 2 min instances 1 vCPU/1 GiB, landing SSR, workers) | ~$95 |
| Cloud SQL PG HA, 2 vCPU / 8 GB, 50 GB SSD, PITR | ~$220 |
| Memorystore Valkey 1 GB basic | ~$35 |
| Global LB + Cloud Armor (standard) + Certificate Manager (first 100 certs) | ~$50 |
| KMS (software keys, ~10K signs/day) | ~$5 |
| Static hosting/CDN for `admin` + `client` SPA bundles | ~$5 |
| Pub/Sub, Cloud Tasks, BigQuery, Logging (within free/low tiers) | ~$30 |
| Staging (scale-to-zero, smallest SQL) | ~$60 |
| **Total** | **≈ $500/mo** (can be trimmed to ~$270 by using non-HA SQL in the first weeks) |

---

## 7. Engineering Standards (normative)

This section is binding. A change that violates it does not get merged, regardless of how well it works. The point is not stylistic uniformity for its own sake — it is that an auth platform accumulates dozens of near-identical flows (twenty OAuth providers, a dozen email templates, five MFA factor types, four delivery channels), and the only way that stays reviewable at team size 5 is if every one of them is the same shape.

### 7.1 Language rules

- **TypeScript only.** No JavaScript source files anywhere in the repo except generated output and config files that cannot be TS.
- `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`, `noFallthroughCasesInSwitch`. These are set once in `tsconfig.base.json` and every package extends it; a package may not relax them.
- **`any` is banned** (lint error). `unknown` at boundaries, narrowed by a validator. Type assertions (`as`) require a comment justifying why the compiler cannot know.
- No enums-as-strings drift: domain enums are TS `enum` or const-object unions declared once in `@idenzy/protocol` and reused by server, SDKs and panels.
- Every value crossing a trust boundary (HTTP body, query, header, webhook payload, Pub/Sub message, env var, provider response) is parsed by a schema before it is typed. Types are a consequence of validation, never a substitute for it.
- ESM everywhere. `NodeNext` resolution. No CommonJS in first-party code.

### 7.2 The class-based mandate

**All domain logic, all infrastructure adapters, and all framework integration are expressed as classes.** Specifically:

1. **Services, repositories, providers, guards, interceptors, strategies, workers, mappers and clients are classes**, registered in a NestJS module and obtained through constructor injection. A service is never imported and called as a module-level function.
2. **Constructor injection only.** No property injection, no service locator, no importing a singleton instance from another file. If a class needs a collaborator, it appears in the constructor signature; that signature is the class's honest dependency list and it is what tests substitute.
3. **Abstract base classes define the contracts of every family of things.** Where two or more implementations of the same idea exist — and in this product they always do — there is an `abstract class` holding the invariant logic and declaring `protected abstract` hooks for the parts that vary. Concrete subclasses implement only the variation. Families that must be modelled this way: OAuth providers, email providers, SMS providers, MFA factors, rate-limit strategies, token issuers, hash algorithms, migration importers, webhook signers, storage backends.
4. **Inheritance for shared invariants, composition for shared capability.** A subclass exists to inherit behaviour it must not be able to skip (the audit write, the rate-limit check, the tenant assertion). Anything a class merely *uses* is injected, not inherited. Deep hierarchies are a smell: the target is base → concrete, with an intermediate layer only when a genuine sub-family exists (e.g. `OAuthProvider` → `OidcProvider` → `GoogleProvider`).
5. **Template Method is the default pattern** for flows. The base class owns the algorithm and its ordering; subclasses fill in steps. This is how we guarantee that no provider implementation can forget to validate `state`, and no delivery channel can forget the spend cap.
6. **Interfaces (`interface`) describe shapes; abstract classes describe behaviour.** Use an interface for a data structure or a purely structural port with no shared logic. Use an abstract class the moment there is one line of logic every implementer must run.
7. `readonly` on every injected dependency and every field not intentionally mutable. `private`/`protected` by default; `public` is a deliberate act of API design. `override` is required (`noImplicitOverride`) so an accidental shadow is a compile error.
8. **Errors are a class hierarchy**, rooted at `IdenzyError` with a stable machine-readable `code`, an HTTP status, a safe public message and an internal detail payload. Every thrown error is an instance of a subclass; `throw new Error("...")` is a lint error. This is what makes "identical error codes across every SDK" (§3.3) enforceable rather than aspirational.
9. **Entities and value objects are classes with behaviour**, not anonymous records passed between functions. A `Session` knows whether it is expired; a `RefreshTokenFamily` knows what reuse means; an `E164PhoneNumber` cannot be constructed invalid. Validation lives in the constructor or a static factory, so an instance's existence is proof of validity.
10. Pure leaf helpers (a string formatter, a comparison, a date calculation) may be plain exported functions. They must be genuinely pure and dependency-free. The moment a helper needs configuration, a clock, a logger or I/O, it becomes an injected class.

**Illustrative shape** — the base that every social provider extends:

```ts
export abstract class OAuthProvider {
  protected constructor(
    protected readonly http: HttpClient,
    protected readonly clock: Clock,
    protected readonly audit: AuditService,
  ) {}

  abstract readonly id: ProviderId;
  protected abstract authorizeEndpoint(): URL;
  protected abstract tokenEndpoint(): URL;
  protected abstract mapProfile(raw: unknown): ProviderProfile;

  /** Template method: ordering and security checks are inherited, never re-implemented. */
  async completeFlow(ctx: TenantContext, cb: OAuthCallback): Promise<ProviderProfile> {
    const flow = await this.loadAndConsumeFlow(ctx, cb.state);   // CSRF: state binding
    this.assertRedirectAllowed(ctx, flow.redirectUri);           // exact-match allowlist
    const tokens = await this.exchangeCode(flow, cb.code);       // PKCE verifier attached here
    this.assertIssuer(tokens);                                   // mix-up defence
    const profile = this.mapProfile(await this.fetchProfile(tokens));
    await this.audit.record(ctx, AuditAction.OAuthCompleted, { provider: this.id });
    return profile;
  }
}

export class GoogleProvider extends OidcProvider { /* endpoints + profile mapping only */ }
```

A new provider is then ~40 lines and cannot omit a security step. That property is the whole reason for the mandate.

### 7.3 Module & dependency rules

- **Dependency direction is one-way:** `apps → feature modules → domain → protocol/primitives`. Nothing in `domain` may import from `infrastructure`; it depends on abstract classes that infrastructure implements. Enforced by lint rules on import paths, checked in CI.
- Each NestJS module has an explicit public surface: what it `exports` is its API. Reaching into another module's internal file is a lint error.
- No circular imports between packages. The workspace graph must be a DAG; CI fails on a cycle.
- Cross-cutting concerns are **never** manual calls inside handlers. Tenancy, authentication of the caller, rate limits, idempotency, audit, and error shaping are guards/interceptors/filters applied declaratively. If a handler has to remember to call something, the design is wrong.

### 7.4 Testing

- Unit tests instantiate classes directly with fakes passed to the constructor — no framework, no mocking of module internals.
- Every abstract base class ships a **conformance test suite** exported as a reusable class; each concrete subclass runs it. A new OAuth provider or SMS provider is not merged until it passes the family's suite. This mirrors the SDK conformance suite in §3.3 and is the same idea applied inward.
- Integration tests run against a real Postgres and Valkey in containers (Testcontainers), including **RLS negative tests** that assert cross-project reads fail at the database even when the repository is deliberately misused.
- Security-critical paths (token rotation, reuse detection, OAuth callback, OTP verification, password reset) require a test that asserts the *attack* fails, not only that the happy path succeeds.
- Coverage gates: 90% on `domain`, 80% overall. Coverage is a floor, not a goal.

### 7.5 Tooling

- **pnpm** (workspaces, strict node-linker so a package cannot use an undeclared dependency), Node LTS pinned via `.nvmrc` and `engines`.
- **Turborepo** for the task graph and remote caching (`build`, `lint`, `typecheck`, `test`, `bundle`).
- **ESLint** (typescript-eslint type-aware rules) + **Prettier**; custom rules for the bans in §7.1–7.3.
- **Changesets** for versioning and publishing the public `@idenzy/*` SDK packages.
- Commit convention: Conventional Commits; PR template includes a threat-model checkbox for any change touching an auth flow.

### 7.6 Supply chain (the cost of choosing npm)

Moving to Node enlarges threat #10 in §4.1, so the controls are explicit:

- Lockfile committed; `pnpm install --frozen-lockfile` in CI; no `postinstall` scripts allowed (`ignore-scripts=true`) with a per-package allowlist for the few native builds we need (Argon2).
- Dependency budget: a new runtime dependency in a security-relevant package requires a reviewer sign-off recorded in the PR. Prefer `node:` builtins; prefer one audited library over three convenient ones.
- Automated advisory scanning on every PR and nightly; SBOM (CycloneDX) published per release; images signed and admitted by Binary Authorization (§4.11).
- Published SDKs use **npm provenance** and are released only from CI, never from a laptop.
- Vendored pinning by integrity hash for anything in the token-signing or password-hashing path.

---

## 8. Monorepo & Package Architecture

### 8.1 Principles

The codebase is **one pnpm workspace**. Apps are thin deployables; all reusable logic lives in packages. A package is created when code has more than one consumer *or* has a boundary worth enforcing — not merely because a folder got large. Every package has its own `package.json`, `tsconfig.json`, tests, and an explicit public entry point; deep imports into another package's `src/` are forbidden.

Three package classes:

- **`@idenzy/*` public** — published to npm, semver-stable, documented: the SDKs.
- **`@idenzy/*` internal** — `private: true`, consumed only inside the workspace: domain, infrastructure, shared UI.
- **apps** — `private: true`, never imported by anything.

### 8.2 Layout

```
idenzy/
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── apps/
│   ├── auth-api/                 # NestJS + Fastify — the public auth API (Cloud Run)
│   ├── management-api/           # NestJS + Fastify — dashboard/management + billing control plane
│   ├── workers/                  # NestJS standalone apps: email, sms, webhook, audit, analytics
│   ├── hosted-ui/                # Nuxt — hosted auth pages on auth.customer.com (SSR)
│   ├── landing/                  # Nuxt — marketing + docs shell            [SSR: ON]
│   ├── client/                   # Nuxt — customer dashboard panel          [SSR: OFF, SPA]
│   └── admin/                    # Nuxt — internal operator console         [SSR: OFF, SPA]
├── packages/
│   ├── protocol/                 # @idenzy/protocol — wire types, error codes, enums, schemas, OpenAPI source of truth
│   ├── core/                     # @idenzy/core — base classes: IdenzyError hierarchy, Clock, Logger, Result, guards, value objects
│   ├── domain/                   # @idenzy/domain — entities, value objects, domain services, abstract ports. Zero infrastructure imports.
│   ├── crypto/                   # @idenzy/crypto — KMS signer, JWT issuer/verifier, Argon2 hasher, token generators, worker pool
│   ├── persistence/              # @idenzy/persistence — connection mgmt, TenantContext, abstract BaseRepository + concrete repositories, migrations
│   ├── cache/                    # @idenzy/cache — Valkey client, abstract RateLimitStrategy + implementations, revocation set
│   ├── providers-oauth/          # @idenzy/providers-oauth — OAuthProvider base + ~20 concrete providers
│   ├── providers-email/          # @idenzy/providers-email — EmailProvider base + SES/Resend/Postmark/SMTP
│   ├── providers-sms/            # @idenzy/providers-sms — SmsProvider base + Twilio/AWS EUM/Vonage/MSG91/WhatsApp + routing table
│   ├── templating/               # @idenzy/templating — MJML compile, sandboxed variable binding, locale fallback chain
│   ├── messaging/                # @idenzy/messaging — Pub/Sub + Cloud Tasks abstractions, outbox, idempotency
│   ├── observability/            # @idenzy/observability — OTel bootstrap, Pino logger, event-loop metrics, audit interceptor
│   ├── config/                   # @idenzy/config — schema-validated config classes, Secret Manager loader
│   ├── testing/                  # @idenzy/testing — fakes, fixtures, Testcontainers harness, conformance suite base classes
│   ├── ui/                       # @idenzy/ui — shared Vue components + design tokens for landing/client/admin/hosted-ui
│   └── sdk/
│       ├── js/                   # @idenzy/js         (public)
│       ├── node/                 # @idenzy/node       (public, server SDK)
│       ├── nuxt/                 # @idenzy/nuxt       (public)
│       ├── react/  next/  vue/  svelte/              (public)
│       └── nest/                 # @idenzy/nest       (public, guards + module for customers on NestJS)
├── infra/
│   ├── terraform/                # cells, LB, Cloud Run, SQL, KMS, Armor
│   └── docker/                   # Dockerfiles, distroless runtime images
└── tools/
    ├── cli/                      # @idenzy/cli — `idenzy init|users import|templates pull|keys rotate`
    ├── openapi/                  # generator: protocol → OpenAPI → non-TS SDKs
    └── eslint-config/            # shared lint config incl. §7 custom rules
```

### 8.3 Boundary rules

| Layer | May import | May never import |
|---|---|---|
| `protocol`, `core` | nothing first-party (leaves) | anything |
| `domain` | `protocol`, `core` | `persistence`, `cache`, `providers-*`, any app |
| `crypto`, `persistence`, `cache`, `providers-*`, `messaging`, `templating` | `protocol`, `core`, `domain` (to implement its abstract ports) | each other's internals; any app |
| `sdk/*` | `protocol`, `core` | `domain`, `persistence`, anything server-side |
| apps | any package | another app |

`domain` declaring an abstract `EmailProvider` and `providers-email` extending it is the inversion that keeps this acyclic: the concrete adapter depends on the domain, never the reverse.

### 8.4 Build & release

- `turbo run build` walks the graph; every package emits ESM + `.d.ts`. Apps additionally bundle to a single file for cold-start (§5.2).
- Server images are distroless, non-root, read-only filesystem, with only the pruned production dependency closure (`pnpm deploy --filter`).
- Public SDKs release through Changesets on tag; internal packages are never published.
- One CI pipeline: `install → typecheck → lint → unit → build → integration (containers) → image → sign → deploy`. Turbo remote cache makes an unaffected package free.

---

## 9. Backend Runtime Architecture (NestJS + Fastify)

### 9.1 Applications

| App | Shape | Notes |
|---|---|---|
| `auth-api` | NestJS HTTP (Fastify adapter) | Public, internet-facing, per-project routing by Host header (customer CNAME). The only app that mints tokens. |
| `management-api` | NestJS HTTP (Fastify adapter) | Dashboard + management API + billing; authenticated by staff/customer session or secret API key. Separate deployment so a dashboard incident cannot degrade sign-in. |
| `workers` | NestJS standalone (no HTTP server) | One module per consumer: email, sms, webhook, audit, analytics. Pub/Sub push endpoints where an HTTP entry is required, otherwise pull. |
| `hosted-ui` | Nuxt SSR | Auth pages served on the customer domain; talks to `auth-api` over the internal path. |

All four share the same packages and the same class conventions; only the transport differs. A worker is a class with a `handle(message)` method registered in a module — not a script.

### 9.2 Module map (inside `auth-api`)

```
AppModule
├── ConfigModule            (global, schema-validated config classes)
├── ObservabilityModule     (global: OTel, Pino, event-loop metrics, RequestContext)
├── PersistenceModule       (global: pool, TenantContext, repositories)
├── CacheModule             (global: Valkey, rate-limit strategies, revocation set)
├── CryptoModule            (KMS signer, JWKS cache, hasher worker pool)
├── TenancyModule           (project resolution by host/key, project config cache)
├── IdentityModule          (users, identities, account linking rules)
├── SessionModule           (sessions, refresh families, reuse detection, revocation)
├── PasswordModule          (Argon2, HIBP check, reset flows)
├── OAuthModule             (flow store + OAuthProvider registry)
├── PasskeyModule           (WebAuthn registration/authentication ceremonies)
├── OtpModule               (email/SMS/WhatsApp challenges)
├── MfaModule               (MfaFactor hierarchy: TOTP, passkey, SMS, recovery codes)
├── HooksModule             (synchronous customer HTTP hooks, timeout + fail-closed policy)
├── EventsModule            (outbox → Pub/Sub: webhooks, audit, analytics)
└── WellKnownModule         (JWKS, OIDC discovery — CDN-cached)
```

Each module owns its controllers, its services and its own DTO schemas, and exports only the services other modules legitimately need.

### 9.3 Request pipeline

Ordered, declarative, identical for every route:

1. **Cloud Armor / LB** — WAF, edge rate limits, TLS termination (§4.9).
2. **Fastify hooks** — request id, structured log binding, body-size cap, JSON schema-compiled parse.
3. **`TenantResolutionGuard`** — resolves project from Host or publishable/secret key; loads cached project config; populates `TenantContext`. No tenant, no request.
4. **`AuthGuard`** subclasses — `PublishableKeyGuard`, `SecretKeyGuard`, `SessionGuard`, `StaffGuard`. All extend a common `BaseAuthGuard` that owns the timing-safe comparison and the failure shape.
5. **`RateLimitInterceptor`** — selects a `RateLimitStrategy` (per IP / per identifier / per project / per endpoint) declared by a decorator on the handler.
6. **`ValidationPipe`** — schema parse of params/query/body into DTO classes. Unknown fields rejected.
7. **`IdempotencyInterceptor`** — for mutating management endpoints.
8. **Controller → domain service** — the controller does nothing but translate DTO ↔ domain and return; all logic is in injected services.
9. **`AuditInterceptor`** — records the action, actor, target, IP, UA to the outbox.
10. **`ExceptionFilter`** — maps the `IdenzyError` hierarchy to the public error contract from `@idenzy/protocol`; anything unrecognized becomes a generic 500 with an internal-only detail. No stack traces, no enumeration-revealing messages.

### 9.4 Persistence & tenancy

- `PersistenceModule` exposes a request-scoped `TenantContext` (project id, actor, request id, trace id) and a `UnitOfWork`.
- `BaseRepository<TEntity, TId>` is abstract: it owns connection checkout, `SET LOCAL app.project_id` from the `TenantContext`, query timing metrics, error translation (unique violation → `ConflictError`, etc.) and the `project_id` predicate. Concrete repositories (`UserRepository`, `SessionRepository`, `RefreshTokenRepository`, …) implement only their SQL.
- A repository **cannot be instantiated without a `TenantContext`** — the tenant filter is structural, not a convention someone might forget. RLS at the database is the second, independent line (§4.10).
- Transactions are explicit through `UnitOfWork.run(cb)`; nested calls join the ambient transaction. The **outbox** (events, webhooks, audit) is written in the same transaction as the state change, then relayed to Pub/Sub — so we never emit an event for a rolled-back write.
- Migrations are numbered SQL files applied by a dedicated Cloud Run job before traffic shifts; forward-only, with an explicit expand/contract discipline for column changes.

### 9.5 Domain class families (what inherits from what)

| Abstract base (in `domain`) | Concrete implementations |
|---|---|
| `OAuthProvider` → `OidcProvider` | Google, Apple, Microsoft, GitHub, GitLab, Discord, Slack, LINE, Kakao, … (~20) |
| `EmailProvider` | SesEmailProvider (primary), Resend, Postmark, SendGrid, Mailgun, GenericSmtp |
| `SmsProvider` | Twilio, AwsEndUserMessaging, Vonage, Msg91, WhatsAppCloud, regional adapters |
| `MfaFactor` | TotpFactor, PasskeyFactor, SmsFactor, RecoveryCodeFactor |
| `TokenIssuer` | KmsEs256Issuer, LegacyHs256Issuer (migration-only, time-boxed) |
| `PasswordHasher` | Argon2idHasher, plus `BcryptHasher`/`ScryptHasher` used **verify-only** for imported hashes, transparently upgrading on next login |
| `RateLimitStrategy` | FixedWindow, SlidingWindow, TokenBucket, AdaptiveBackoff; `PostgresFallbackStrategy` for Valkey outage |
| `MigrationImporter` | FirebaseImporter, SupabaseImporter, Auth0Importer, ClerkImporter, CognitoImporter |
| `NotificationTemplate` | EmailTemplate, SmsTemplate (shared locale fallback + sandboxed binding in the base) |
| `AuthFlow` | PasswordFlow, MagicLinkFlow, EmailOtpFlow, SmsOtpFlow, PasskeyFlow, OAuthFlow, AnonymousFlow, IdTokenExchangeFlow — the base owns hook invocation, audit, session creation and event emission ordering |

`AuthFlow` is the most important of these: every way a user can sign in ends in the same inherited `issueSession()` path, so session creation, MFA gating, `amr` claim assembly and event emission are written once.

### 9.6 Node-specific operational rules

- **Never block the event loop.** Argon2 hashing, key wrapping, MJML compilation and bulk import parsing run on a bounded `worker_threads` pool exposed as an injectable `WorkerPool` class. A synchronous crypto call on the request path is a review rejection.
- Event-loop lag, GC pause and heap usage are exported as metrics with SLOs (§6.3); Cloud Run concurrency is tuned against measured lag, not guessed.
- Explicit graceful shutdown: `SIGTERM` → stop accepting, drain in-flight, flush outbox relay and OTel, close pool. Cloud Run revisions must not drop a token refresh mid-rotation.
- Timeouts and `AbortSignal` on every outbound call (KMS, providers, hooks, HIBP); no unbounded `fetch`. Customer hooks are fail-closed with a hard deadline.
- `unhandledRejection` and `uncaughtException` are fatal: log, flush, exit non-zero, let Cloud Run replace the instance. A process in unknown state does not keep serving auth traffic.
- Memory ceilings set explicitly (`--max-old-space-size`) below the container limit so we get a clean OOM rather than a hung instance.

---

## 10. Front-End Architecture (Nuxt, three panels)

### 10.1 The split

Three separate Nuxt applications, one shared component library (`@idenzy/ui`), one shared API client generated from `@idenzy/protocol`.

| Panel | App | Rendering | Audience | Hosting |
|---|---|---|---|---|
| **Landing** | `apps/landing` | **SSR on** (`ssr: true`) | Anonymous public — marketing, pricing, docs shell, blog, changelog | Cloud Run, behind Cloud CDN |
| **Client** | `apps/client` | **SSR off** (`ssr: false`, SPA) | Authenticated customers — the dashboard of §3.2 | Static bundle on GCS + Cloud CDN |
| **Admin** | `apps/admin` | **SSR off** (`ssr: false`, SPA) | Internal operators only | Static bundle, IAP/VPN-gated origin |

(`apps/hosted-ui` is a fourth Nuxt app, SSR, serving the customer-domain auth pages — it is part of the product surface, not a panel, and is listed here so the front-end inventory is complete.)

### 10.2 Why this split

- **Landing needs SSR** because it is indexed, shared, and judged on first paint. Server rendering is the only way to get correct meta/OG tags per route and a fast LCP on marketing traffic.
- **Client and admin must not have SSR.** They are behind authentication, invisible to crawlers, and SEO-irrelevant, so SSR would buy nothing while adding a server that holds customer session material — a real attack surface for zero benefit. As static SPAs they cost nothing to serve, deploy by uploading files, roll back instantly, and cannot leak one tenant's data into another's rendered HTML because no rendering happens on our servers at all.
- Splitting client from admin is a **blast-radius decision**: operator tooling (impersonation, spend caps, tenant suspension) is the highest-privilege code we write and never ships in the same bundle a customer downloads.

### 10.3 Shared conventions

- Nuxt (latest) with `<script setup lang="ts">`, TypeScript strict, Pinia for state, Vue Router via file-based routing, Vitest + Playwright.
- **Class-based where classes belong.** Vue components are SFCs — that is the framework's unit and we do not fight it. But everything behind the component layer is a class: API clients, Pinia store logic delegated to injectable service classes, form models, permission policies, error mapping. `@idenzy/ui` exposes an abstract `ApiClient` with `AuthApiClient` / `ManagementApiClient` subclasses, and an `ErrorPresenter` hierarchy that maps `@idenzy/protocol` error codes to localized UI messages. The rule from §7.2 applies to all non-SFC code in the panels.
- Auth for `client` and `admin` uses our own product (dogfooding): first-party HttpOnly cookies on the panel's domain, access token in memory, silent refresh — exactly the model we sell (§4.3). Staff accounts on `admin` require MFA and are additionally IP/IAP-gated.
- `landing` calls no authenticated API. If a page needs user state, it links to `client`; the two never share a bundle or a token.
- Shared design tokens, i18n catalogues (30+ locales, §3.2) and accessibility baseline (WCAG 2.2 AA, audited) live in `@idenzy/ui` so all four surfaces stay identical.
- CSP is strict on every panel; no third-party scripts on `client`, `admin` or `hosted-ui`. Analytics on `landing` only, self-hosted or cookieless.

### 10.4 Build & deploy

- `client` / `admin`: `nuxt generate`-style SPA build → immutable hashed assets to GCS → CDN with a short-TTL `index.html` and long-TTL assets. Runtime config is injected at build per environment; no secrets in the bundle (publishable keys only).
- `landing`: Nuxt Nitro server on Cloud Run, route-rules-driven ISR/CDN caching so most requests are served from the edge and SSR cost stays flat as traffic grows (§5.2 lever 5).
- Preview deployments per PR on `*.idenzy.dev`, which is also the domain allowlisted for instant-mode OAuth (§4.6).

---

## 11. Email & SMS Subsystem

### 11.1 Provider abstraction

The ports live in `@idenzy/domain` as abstract classes; the adapters live in `@idenzy/providers-email` and `@idenzy/providers-sms` and extend them (§8.3). The base owns everything that must never be skipped — spend caps, suppression-list checks, rate ceilings, cost accounting, audit — and leaves only the transport to the subclass.

```ts
export abstract class EmailProvider {
  protected constructor(
    protected readonly suppression: SuppressionList,
    protected readonly meter: UsageMeter,
    protected readonly clock: Clock,
  ) {}

  abstract readonly id: EmailProviderId;
  protected abstract dispatch(msg: OutboundEmail): Promise<ProviderMessageId>;
  abstract createSendingDomain(domain: DomainName): Promise<DnsRecords>;  // SES: CreateEmailIdentity + DKIM
  abstract verifyDomain(domain: DomainName): Promise<DomainStatus>;

  /** Template method — inherited guarantees, per-provider transport. */
  async send(ctx: TenantContext, msg: OutboundEmail): Promise<ProviderMessageId> {
    await this.suppression.assertSendable(ctx, msg.to);
    await this.meter.assertWithinQuota(ctx, Channel.Email);
    const id = await this.dispatch(msg);
    await this.meter.record(ctx, Channel.Email, { provider: this.id, messageId: id });
    return id;
  }
}

export abstract class SmsProvider {
  abstract readonly id: SmsProviderId;
  protected abstract dispatch(to: E164PhoneNumber, body: string, senderId: string): Promise<SmsDispatchResult>;
  abstract quoteCost(to: E164PhoneNumber): Promise<Money>;

  async send(ctx: TenantContext, to: E164PhoneNumber, body: string, senderId: string): Promise<ProviderMessageId> {
    await this.fraudGuard.assertAllowed(ctx, to);        // country allowlist, velocity, attestation
    const cost = await this.quoteCost(to);
    await this.spendCap.reserve(ctx, cost);              // hard stop before money is spent
    const res = await this.dispatch(to, body, senderId);
    await this.spendCap.settle(ctx, res.actualCost ?? cost);
    return res.messageId;
  }
}
```

Implementations: **SES** (primary), Resend/Postmark/SendGrid/Mailgun (secondary + BYO), generic SMTP (BYO); **Twilio Programmable SMS**, **AWS End User Messaging**, Vonage, MSG91 (India), regional providers (e.g. for Turkey and MENA where Twilio is expensive), **WhatsApp Cloud API**. A `ProviderRouter` class holds the per-country routing table, picks the cheapest provider with acceptable deliverability, and fails over automatically on provider error rates. Every provider must pass the shared `EmailProviderConformanceSuite` / `SmsProviderConformanceSuite` before it can be registered (§7.4).

We generate OTPs ourselves rather than using Twilio Verify ($0.05/verification on top of SMS): raw SMS is 3–5× cheaper and we keep full control over templates, retry and fraud logic.

### 11.2 AWS SES setup (concrete)

1. Production access requested for a dedicated AWS account (out of sandbox), region `eu-west-1` + `us-east-1` for redundancy.
2. Shared sending domains: `mail.idenzy.dev` (free tier) with SPF, DKIM (Easy DKIM 2048), DMARC `p=reject`, custom MAIL FROM domain for bounce alignment.
3. **Customer custom domains**: dashboard calls `CreateEmailIdentity` → shows 3 DKIM CNAMEs + MAIL FROM MX/TXT; we poll `GetEmailIdentity` until verified. Each customer domain is a separate SES identity under our account (or in the customer's own AWS if BYO).
4. **Configuration sets** per plan tier with event publishing (send, delivery, bounce, complaint, reject) → SNS → HTTPS webhook into our `email-events` worker → suppression list (hard bounces & complaints never re-sent; surfaced in the customer dashboard as `email.bounced` webhooks).
5. Dedicated IPs only when volume > ~500K/day; before that, shared IP pools with SES reputation monitoring; Virtual Deliverability Manager enabled once volume justifies it.
6. Rate limiting per project to protect our reputation; new projects start with a low daily ceiling that grows with a clean bounce rate.

### 11.3 Template engine & studio

- Template types: `email_verification`, `magic_link`, `email_otp`, `password_reset`, `email_change_old`, `email_change_new`, `invite`, `new_device_signin`, `mfa_enrolled`, `password_changed`, plus custom.
- Authoring: **MJML** (responsive, compiled to bulletproof HTML) with **Handlebars-style variables** (`{{user.email}}`, `{{otp}}`, `{{link}}`, `{{project.name}}`, `{{expires_in}}`) and a strict sandbox (no arbitrary code, output HTML-escaped, `link` values signed and pinned to our domains to prevent open-redirect via templates). MJML compilation is CPU-bound and therefore runs on the worker pool, never inline on the request path (§9.6); compiled output is cached by template version.
- Studio features: visual editor + raw MJML/HTML mode, live preview with sample data, test send, per-locale variants with fallback chain (`tr-TR → tr → en`), plain-text auto-generation, brand kit (logo, colors, fonts), versioning with rollback, subject-line and from-name per template, reply-to, custom headers, attachments disabled (security). Shipped inside the `client` panel (§10).
- Defaults: a clean, accessible set of templates in 30+ languages ships with every project; customers can start with zero configuration.
- "Send-email hook": customers can intercept and send through their own system (Supabase-style) — we then charge nothing.

### 11.4 SMS templates

- Short template per event and per locale with `{{otp}}`, `{{project.name}}`, `{{expires_in}}`; length guard for GSM-7 vs UCS-2 segments (cost!); optional Android SMS Retriever hash appended for auto-fill; alphanumeric sender ID registration per country handled in dashboard (regulatory forms for e.g. India DLT, Turkey İYS-style rules, US 10DLC/toll-free).

---

## 12. Data Model (core tables, Postgres)

```
projects(id, org_id, name, region, plan, settings jsonb, kms_key_name, created_at)
project_domains(project_id, domain, type[auth|email], status, dns_records jsonb)
users(id, project_id, email, email_verified, phone, phone_verified, password_hash, password_algo_version,
      display_name, avatar_url, metadata_public jsonb, metadata_private jsonb, banned_until,
      last_sign_in_at, created_at, updated_at, deleted_at)
identities(id, user_id, project_id, provider, provider_user_id, email, provider_data jsonb,
           encrypted_tokens bytea, created_at)      -- unique(project_id, provider, provider_user_id)
sessions(id, user_id, project_id, device_id, ip, user_agent, amr[], factor_verified_at, created_at,
         last_active_at, idle_expires_at, absolute_expires_at, revoked_at, revoke_reason)
refresh_tokens(id, session_id, family_id, token_hash, parent_id, used_at, revoked_at, expires_at, device_key_id)
mfa_factors(id, user_id, type[totp|passkey|sms|recovery], secret_encrypted, credential jsonb, verified_at, last_used_at)
webauthn_credentials(id, user_id, credential_id, public_key, sign_count, transports[], aaguid, backup_eligible, name)
otp_challenges(id, project_id, channel, target_hash, code_hash, flow_id, attempts, expires_at, consumed_at)
oauth_flows(id, project_id, provider, code_verifier_hash, state, nonce, redirect_uri, expires_at)
oauth_providers(project_id, provider, client_id, client_secret_encrypted, scopes[], enabled, mode[instant|custom])
email_templates(project_id, type, locale, subject, mjml, html, text, version, updated_by)
audit_events(id, project_id, actor_type, actor_id, action, target, ip, ua, metadata jsonb, created_at)  -- partitioned by month
webhooks(id, project_id, url, secret_hash, events[], enabled) / webhook_deliveries(...)
api_keys(id, project_id, kind[publishable|secret], prefix, hash, scopes[], last_used_at, revoked_at)
usage_daily(project_id, day, mau_hll, emails_sent, sms_sent, sms_cost)   -- HyperLogLog sketch for MAU
outbox(id, project_id, topic, payload jsonb, created_at, published_at, attempts)  -- transactional event relay (§9.4)
```
All tenant tables carry `project_id` and are protected by RLS policies keyed on `current_setting('app.project_id')`.

The schema is the source of truth: entity classes in `@idenzy/domain` map onto it explicitly through repositories (§9.4), and no ORM is permitted to generate or drift it.

---

## 13. Developer Experience: the 5-minute setup

```bash
npx idenzy init          # creates project, writes .env with publishable key, picks framework
```
```tsx
// Next.js — that's the whole integration
import { IdenzyProvider, SignIn, useUser } from "@idenzy/next";
export default function App({ children }) {
  return <IdenzyProvider publishableKey={process.env.NEXT_PUBLIC_IDENZY_KEY}>{children}</IdenzyProvider>;
}
```
```ts
// Nuxt — module + one runtime config key
export default defineNuxtConfig({
  modules: ["@idenzy/nuxt"],
  idenzy: { publishableKey: process.env.NUXT_PUBLIC_IDENZY_KEY },
});
```
```dart
// Flutter
await Idenzy.init(publishableKey: 'pk_live_...');
final user = await Idenzy.signInWithOAuth(Provider.google);
```

- **Hosted pages first**: `auth.customer.com/sign-in` works with zero frontend code; embeddable components are the upgrade path.
- **Dashboard wizard** per OAuth provider: exact steps, redirect URI pre-filled and copyable, live "Test connection" button.
- Local dev: `localhost` allowed on dev keys, **instant OAuth** via shared apps, email/SMS "log to console" mode with an inbox viewer in the dashboard (no real sends in dev).
- Documentation: per-platform quickstarts, a "Security model explained" page, migration guides, OpenAPI reference, Postman collection, and an MCP server so AI coding tools can integrate our SDKs correctly. Docs are served by the `landing` panel (SSR — they need to be indexed).
- CLI: `idenzy users import`, `idenzy templates pull/push`, `idenzy keys rotate`.

**Internal DX** (our own team): `pnpm i && pnpm dev` boots Postgres + Valkey in containers, runs migrations, starts `auth-api`, `management-api`, workers and all Nuxt panels through Turbo with hot reload — one command, no per-service setup. `pnpm gen:openapi` regenerates the spec and the non-TS SDK clients from `@idenzy/protocol`.

---

## 14. Delivery Plan

| Phase | Duration | Scope |
|---|---|---|
| **0 — Foundations** | 5 weeks | pnpm workspace + Turbo + strict TS baseline + lint rules enforcing §7; Terraform for one cell; NestJS/Fastify skeleton on Cloud Run; Postgres schema + RLS + migration runner; `BaseRepository`/`TenantContext`; KMS signing; JWKS/OIDC discovery; `IdenzyError` hierarchy + error contract in `@idenzy/protocol`; Nuxt scaffolds for `landing` (SSR), `client` and `admin` (SPA); CI with Binary Authorization, provenance and dependency policy. |
| **1 — MVP (private beta)** | 8 weeks | Email+password, email OTP/magic link (SES), Google/Apple/GitHub/Microsoft OAuth (instant + custom), passkeys, sessions/refresh rotation, hosted pages, JS core + React + Next + Nuxt SDKs, Node server SDK, template studio v1, webhooks, usage metering, Cloud Armor rules, `client` panel v1. |
| **2 — Public launch** | 8 weeks | SMS/WhatsApp OTP with fraud controls, TOTP MFA + recovery codes, Vue/SvelteKit/Flutter/iOS/Android/React Native SDKs, custom auth domains, custom email domains, migration importers, billing (Stripe), `admin` panel v1, status page, SOC 2 readiness. |
| **3 — Breadth** | 12 weeks | Angular/Solid/Astro/Unity/Godot/KMP, Python/PHP/Ruby/Java/.NET server SDKs, second region cell, app attestation, device-bound tokens, security center, hooks. |
| **4 — B2B** | 12 weeks | Organizations, roles/permissions, invitations, SAML/OIDC SSO, SCIM, dashboard SSO, audit log export, enterprise SLA. |

Team for phases 0–2: 2 backend (TypeScript/NestJS, one with a security background), 1 frontend (Nuxt panels + hosted UI + components), 1–2 SDK engineers (mobile + web), 1 DevOps/SRE (part-time), plus an external pen test before public launch. The single-language stack means the frontend engineer can review protocol changes and the SDK engineers share the backend's types — that overlap is what makes this headcount realistic.

Phase 0 is deliberately front-loaded: the class hierarchies, boundary lint rules and conformance-suite harness are built once, before any auth flow ships. Every phase after it is faster because a new provider, factor or channel becomes a subclass and a test run.

---

## 15. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| A security incident kills trust (existential for an auth vendor) | Strict SDLC, external pen test before launch, bug bounty, small blast radius (per-project keys, RLS), rehearsed IR plan, transparent disclosure policy. |
| **npm supply-chain compromise** (large transitive dependency surface) | Dependency budget with sign-off, `ignore-scripts` + allowlist, frozen lockfile, integrity pinning on the crypto path, nightly advisory scans, SBOMs, CI-only publishing with provenance (§7.6). |
| **Event-loop stall degrades the whole instance** | Worker pool for all CPU-bound work, event-loop lag as an alerting SLO (§6.3), load tests that specifically exercise Argon2 concurrency, `--max-old-space-size` below the container limit. |
| **Node memory/CPU cost erodes margin** | Cost model already uplifted (§5.2); Fastify + high concurrency + bundled cold starts; quarterly cost-per-MAU review with a hard tripwire at $0.0008 marginal. |
| **Class-based architecture ossifies into over-abstraction** | Hierarchies stay shallow (base → concrete); an abstraction requires two real implementations before it is introduced; conformance suites keep bases honest; architecture review at each phase boundary. |
| SMS pumping fraud burns margin | Attestation/CAPTCHA before send, country allowlists, spend caps, anomaly throttles, WhatsApp-first in expensive regions. |
| Free-tier abuse | Project verification, quotas, MAU anomaly detection, Cloud Armor. |
| Email deliverability / reputation on shared domains | Per-project warm-up ceilings, suppression lists, DMARC reject, provider failover, dedicated IPs at volume. |
| Provider dependency (SES/Twilio/Meta) | Abstraction layer + at least two live providers per channel. |
| Price war (Firebase/Supabase drop prices) | Our differentiators are security defaults, managed delivery, and platform breadth, not only price. Cost structure supports going lower. |
| SDK sprawl (20+ platforms) | One spec, generated core, conformance test suite every SDK must pass, community contributions for Tier 2. |
| Monorepo build times grow with package count | Turbo remote caching, affected-only pipelines, per-package typecheck; build time is tracked as a team metric with a 10-minute CI budget. |
| Cloud Run / Cloud SQL scaling ceilings | Read replicas, table partitioning (audit, sessions), AlloyDB migration path, additional cells. |

---

## 16. Open Decisions (to resolve before Phase 0 ends)

1. Default access-token TTL: 5 min (proposed) vs 60 s (Clerk parity, higher cost).
2. Launch region: `europe-west4` (cheaper, near TR/EU customers) vs `us-central1` (largest market).
3. Valkey from day one vs Postgres-only rate limiting for the first months.
4. ~~Product name and domains~~ — **Resolved: "Idenzy".** `idenzy.dev` and `idenzy.io` are both available; recommended split: `idenzy.dev` for docs/SDK npm scope/dev-mode preview domains (`*.idenzy.dev`), `idenzy.io` for the marketing site and dashboard (`app.idenzy.io`), matching the convention Clerk/Supabase/Vercel use (`.dev` = developer surface, `.io`/`.com` = commercial surface). Register both plus `idenzy.com` defensively before any public announcement.
5. Whether to open-source the auth server (Supabase-style trust signal) while keeping the managed cloud as the business.
6. Billing granularity for email: per-send vs monthly bundles.
7. Query layer: hand-written SQL with a thin repository base (proposed) vs a typed query builder (Kysely) for compile-time column safety. Either is compatible with §9.4; an ORM with its own migration engine is not.
8. Panel hosting for `client`/`admin`: GCS+CDN static (proposed) vs Firebase Hosting for simpler preview channels.
9. Whether `management-api` stays a separate deployment at launch or ships as a second module inside `auth-api` until traffic justifies the split (separation is preferred; cost is ~$25/mo).

---

## Appendix — Reference numbers used (Sept 2026)

- Firebase/Identity Platform: 50K MAU free; $0.0055 / $0.0046 / $0.0032 / $0.0025 tiers; SAML/OIDC $0.015/MAU; SMS $0.01–0.46 by country.
- Supabase: 50K MAU free (Free), 100K (Pro $25/mo), then $0.00325/MAU; SSO $0.015/MAU; Advanced MFA $75/mo.
- Clerk: 50K MRU free since Feb 2026; Pro $25/mo + $0.02/MRU; 60-second session JWTs refreshed by SDK; client token cookie on FAPI CNAME.
- AWS SES: $0.10 per 1,000 emails; dedicated IP $24.95/mo.
- Twilio Verify: ~$0.05/verification + SMS cost; raw US SMS ≈ $0.008–0.02 across providers; WhatsApp auth messages ≈ $0.0014–0.0034.