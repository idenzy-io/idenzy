# PROJECT: Idenzy Authentication Platform

> A managed authentication & user-management platform (Firebase Auth / Supabase Auth / Clerk category), delivered as a hosted service on Google Cloud, with first-class SDKs for every major web, mobile and game platform. **Design pillars: extreme security by default, five-minute integration, and the lowest per-MAU price in the market.**

Document status: Architecture & scope blueprint (September 2026). Name finalized: **Idenzy**. Both domains are held; **everything runs on `idenzy.io`** and `idenzy.dev` redirects to it (§16). `idenzy.com` is still worth holding defensively.

**How to read this.** Sections 1 to 6 define the product, the security model, the cloud architecture and the economics. Sections 7 to 10 are normative about implementation: the stack is **TypeScript on Node.js**: NestJS on a Fastify HTTP adapter for every service, **Drizzle** for schema and data access, a **pnpm workspace monorepo** for the whole codebase, and **Nuxt (latest)** for the three front-end panels (admin, client, landing). They define the package layout, the mandatory class-based engineering model and the panel split, and they are binding rather than advisory.

**Two things to internalize before reading further:**

1. **We ship no authentication UI.** No hosted sign-in pages, no embeddable components, no widget, no iframe. The auth API speaks JSON and HTTP redirects; the sign-in screen belongs to the customer's application. Everything in this document follows from that (§3.2, §10, ADR-0002).
2. **The data architecture is compliance-shaped from day one** (classification, audit integrity, data-subject rights, key custody; §4.13), while no certification is held or claimed. Residency is **not** offered (§4.13.5), and the compliance programme itself is parked until there is revenue (`docs/compliance/TODO.md`).

---

## 0. TL;DR

| Topic | Decision |
|---|---|
| What we sell | Hosted auth **API** + SDKs + dashboard. Customers never touch tokens, keys or crypto. **No UI of any kind is shipped for authentication.** |
| Free tier | 50,000 MAU/month free (matches Firebase, Supabase, and Clerk's Feb-2026 50K tier). |
| Paid | **$0.0025 per MAU** above 50K (flat, no tiers). Email/SMS/passwordless delivery is metered separately with a margin. |
| Core stack | **TypeScript (strict) · NestJS on Fastify · Node.js LTS** services on Cloud Run · Cloud SQL for PostgreSQL (HA) · Memorystore (Valkey/Redis) · Cloud KMS · Global HTTPS LB + Cloud Armor · Pub/Sub + Cloud Tasks · Terraform. |
| Data access | **Drizzle**. Schema-in-TypeScript is the source of truth and `drizzle-kit` generates forward-only SQL migrations. RLS policies used to be declared in the schema beside the tables they protected; they were removed in favour of repository-level scoping alone (§4.10, §9.4). |
| Codebase | **Single pnpm workspace monorepo**, split into publishable/internal packages under `@idenzy/*`; apps consume packages, packages never consume apps. |
| Code style | **Class-based throughout.** Abstract base classes, inheritance, interfaces, decorators and constructor DI are mandatory; free-floating functions and ad-hoc object literals are not the unit of composition (see §7). |
| Front end | **Nuxt (latest), three panels**: `landing` (**SSR**, public marketing + docs shell), `admin` (**SPA, no SSR**: internal operator console), `client` (**SPA, no SSR**: customer dashboard). None of these is authentication UI; they are our own surfaces. |
| Token model | Asymmetric-signed (ES256) short-lived access tokens (default 5 min, configurable down to 60 s) + opaque rotating refresh tokens with reuse detection + server-side revocable sessions. Per-project signing keys in KMS. |
| Web security model | First-party HttpOnly cookies on the customer's own (sub)domain via CNAME; no tokens in `localStorage`. |
| Passwordless default | **Email/SMS OTP codes.** Magic links are supported but redirect into the customer's own application (§4.7). We render nothing. |
| Delivery | Provider-abstracted: AWS SES (email, primary), Twilio / AWS End User Messaging / regional SMS providers (SMS), WhatsApp as cheap OTP channel. Customers can bring their own provider. |
| Compliance | Architecture built to satisfy SOC 2 Type II, ISO 27001, GDPR and HIPAA (§4.13). **No certification is held or claimed today**; the structure exists so pursuing one is an audit, not a rebuild. |
| Why we can be cheaper | Fully multi-tenant shared infrastructure (zero per-tenant fixed cost), Cloud Run scale-to-near-zero, aggressive caching, no marketing-email features, no per-tenant DB, and no UI surface to build, host, theme, localize or maintain. |

---

## 1. Vision & Positioning

**Problem.** Every app needs sign-in. Today teams choose between:

- **Firebase Auth**: cheap and simple, but locked into Google's client model, weak session control, no custom email domains, primitive templates, and pricing that steps down only at huge scale.
- **Supabase Auth**: good value, open source, but tied to the Supabase Postgres project model; email/SMS require the customer to configure their own provider; MFA and SSO cost extra.
- **Clerk**: best developer experience and prebuilt UI, but the most expensive (≈ $0.02/MRU past the free tier) and JavaScript/Next.js-centric; other platforms are second-class.

**Our position:** *"Clerk-grade security and DX, Firebase-grade platform reach, cheaper than Supabase, and your sign-in screen stays yours."*

Three promises we optimize every decision against:

1. **Secure by default.** A developer who accepts every default gets an architecture that passes a serious pen test. Insecure options don't exist or are clearly labeled "dangerous".
2. **Five-minute integration.** Create project → install the SDK → paste one line of config → your existing form signs users in, including Google/Apple/GitHub OAuth, email OTP, and passkeys. Not five minutes to a *generic* sign-in box, but five minutes to sign-in inside the UI the team already has.
3. **Cheapest honest price.** $0.0025/MAU flat, 50K free, transparent pass-through pricing for email/SMS.

### 1.1 The explicit non-goal: we do not ship UI

This is a product boundary, not an implementation detail, and it is worth stating before the competitive analysis so the comparisons read correctly.

**Idenzy ships a backend and SDKs.** We do not ship hosted authentication pages, embeddable components, widgets, iframes, or any other artifact that renders a sign-in experience. The auth API returns JSON and HTTP redirects. The screen belongs to the customer.

Why this is the right trade for us:

- **It is the honest division of labour.** A sign-in screen is the most brand-sensitive surface in most products. Every serious team replaces the vendor's component eventually; shipping one mostly buys a good demo and then becomes a theming-API maintenance burden across every framework we support.
- **It deletes an attack surface.** We render no HTML, so XSS, clickjacking and CSS-injection against our surface do not exist. There is no third-party script on the customer's sign-in page because there is no page of ours involved. This is a real security argument, not a rationalization (§4.3).
- **It removes the widest cost line.** Components across React/Vue/Svelte/Angular/Flutter/iOS/Android, themable, localized into 30+ languages, accessibility-audited, versioned forever. That is a permanent team, and it is a large part of why Clerk costs $0.02/MRU.
- **It is platform-neutral by construction.** Our Unity, Godot and Kotlin Multiplatform SDKs are not second-class citizens waiting on a UI toolkit, because there is no UI to port.

What we do instead, so that "five-minute integration" stays true: typed headless primitives that mirror each framework's idioms, framework middleware that handles the boring parts (route protection, SSR session reading, token refresh), a `idenzy init` CLI that scaffolds working routes into the customer's own repository, and per-framework quickstarts with copy-paste starter code. Code a customer copies into their repo and owns is categorically different from a component we publish and control; the line we hold is that **nothing we publish renders auth UI**.

The cost of this choice is honest and recorded as a risk in §15: time-to-first-login is longer than Clerk's, and we lose the "look, three lines" demo.

---
## 2. Competitor Research: How They Actually Work

### 2.1 Firebase Authentication / Google Cloud Identity Platform

**Architecture**
- Client SDKs talk directly to Google's Identity Toolkit REST API (`identitytoolkit.googleapis.com`) and the Secure Token API.
- On sign-in the client receives an **ID token** (RS256 JWT, 1-hour lifetime) and a **refresh token** (long-lived, opaque). The client SDK auto-refreshes the ID token.
- Backends verify ID tokens offline with Google's public keys (JWKS, `kid` rotation), with no network round trip.
- Tokens live in the client (IndexedDB / Keychain / Keystore). Web sessions are client-side by default; "session cookies" for SSR require the Admin SDK to mint them server-side.
- Revocation: refresh tokens can be revoked; ID tokens remain valid until expiry unless the backend checks `checkRevoked` (a network call).
- Extensibility via "blocking functions" (Identity Platform) that run before sign-up / sign-in.
- Google/Apple/Facebook/etc. OAuth works with Google-managed shared OAuth apps for Google sign-in; others require customer-supplied credentials.
- Email templates: limited customization (subject, body text, sender name), custom SMTP optional; **custom sending domain requires DNS setup and is limited.**

**Pricing (2026)**
- Free: first 50,000 MAU (email, phone, anonymous, social).
- Then tiered: $0.0055 (50K to 100K), $0.0046 (100K to 1M), $0.0032 (1M to 10M), $0.0025 (10M+).
- SAML/OIDC: 50 MAU free, then $0.015/MAU.
- SMS: per message, region-priced (≈ $0.01 US up to ≈ $0.46), 10/day free.

**Lessons for us**
- Offline JWT verification with JWKS is table stakes.
- Their weakest points: no first-party cookie model for web, coarse revocation, poor email customization, tiered pricing that only reaches $0.0025 at 10M MAU. **We start at $0.0025.**
- FirebaseUI is the cautionary tale for our §1.1 decision: an official UI library that aged badly, lagged the frameworks it targeted, and that most serious teams replaced anyway. Shipping one is a commitment that outlives its usefulness.

### 2.2 Supabase Auth (the "Auth" server)

**Architecture**
- A single dedicated auth service in front of Postgres (`auth` schema: `users`, `identities`, `sessions`, `refresh_tokens`, `mfa_factors`, `flow_state`, `audit_log_entries`, …).
- Issues **JWT access tokens** (historically HS256 with a project-wide shared secret; since 2025 supports asymmetric signing keys with JWKS and key rotation) plus **refresh tokens** stored in DB with **rotation + reuse detection** ("refresh token families": reusing a revoked token invalidates the whole session).
- Access token default 1 hour, configurable ≥ 5 min.
- OAuth via server-side redirect flow (`/authorize` → provider → `/callback`) with PKCE for mobile/SSR; the customer supplies provider credentials.
- Email: customer configures SMTP (built-in SMTP is rate-limited to a handful of emails/hour and dev-only). Templates use a simple variable-substitution syntax (`{{ .ConfirmationURL }}`, `{{ .Token }}`), editable in the dashboard.
- SMS: customer configures Twilio / MessageBird / Vonage / Textlocal.
- Row Level Security (RLS) integration is the "moat": the JWT's claims are usable inside Postgres policies. (Theirs, not ours — we removed our own RLS; see §4.10.)
- Auth Hooks (Postgres functions or HTTP) for customizing claims, password checks, send-email/send-SMS overrides.
- MFA: TOTP free; phone MFA and "Advanced MFA" paid add-on; SAML SSO on paid tiers at $0.015/SSO MAU.

**Pricing (2026)**
- Free: 50,000 MAU. Pro ($25/mo): 100,000 MAU included, then **$0.00325 per MAU**.
- Counts logins/active sessions per month, not stored users.

**Lessons for us**
- The Postgres-backed refresh-token-family model is simple, auditable and correct. We adopt it.
- Their email/SMS story ("bring your own SMTP") is a real pain point, so **we offer a ready-to-use managed delivery layer with templates**.
- Hooks-style extensibility (HTTP webhooks that can block or modify) is worth copying.
- Their "Auth UI" library was effectively deprecated in favour of pointing people at their own components, independent confirmation of §1.1.
- What makes their model correct is the schema and the token-family invariants, not the implementation. We enforce what the database can still enforce — constraints, unique indexes, the append-only audit grants — in the database as well as in application code. Tenant isolation is no longer among them (§4.10).

### 2.3 Clerk

**Architecture**
- Two token architecture:
  - **Client token** (`__client` cookie, HttpOnly) is set on Clerk's **Frontend API (FAPI)** domain (e.g. `clerk.customer.com` CNAME). It's the long-lived source of truth for the session, contains an anti-fixation rotating value, and defines the session lifetime.
  - **Session token**, a **60-second RS256 JWT**, placed in a `__session` cookie on the customer's app domain by the JS SDK. Backends verify it offline via JWKS.
- The SDK refreshes the session token on a ~50-second interval in the background. On server-rendered requests with an expired token, Clerk middleware performs a "handshake" redirect through FAPI to mint a fresh one.
- Because the JWT lives only 60 s, a stolen JWT is nearly useless; revocation is effectively immediate (≤ 60 s). Price: a token-refresh request per user per minute, expensive at scale, which they pass on in the price.
- Prebuilt UI components (`<SignIn/>`, `<UserButton/>`, `<OrganizationSwitcher/>`), customizable via an "appearance" prop and theming.
- Organizations / B2B (roles, invitations, SAML) as first-class product.
- Session token is customizable with templates (custom claims).
- Backend API for server-side user management; webhooks (Svix) for user lifecycle.

**Lessons for us**
- The **FAPI-on-customer-CNAME** trick is the right way to get first-party HttpOnly cookies while still being a hosted service. We adopt it (`auth.customer.com` → our LB). Note that this mechanism is entirely independent of their UI components: it is a DNS and cookie-scoping technique, and it works exactly as well for a headless SDK.
- 60-second tokens are the gold standard for revocation latency; but for our price point we make lifetime **configurable (60 s to 1 h, default 5 min)** and use a **revocation set** to give fast revocation without a per-minute refresh storm.
- **Their prebuilt components are their moat, and we decline to compete on it** (§1.1). That is the single largest divergence between our product and theirs. Their components are genuinely excellent and cost a permanent, growing team to maintain across every framework, a cost that is visible in the $0.02/MRU price. We spend that money on being 8× cheaper instead, and we give the customer their own sign-in screen rather than a theming API for ours.
- "First day free" MRU is smart billing; we adopt a similar rule (see §5).

**Pricing (2026)**
- Free tier raised to 50,000 "MRU" (monthly retained users: a user's first day is free, so drive-by sign-ups aren't billed) on Feb 5, 2026.
- Pro: $25/mo + **$0.02/MRU** beyond 50K. MFA, custom session duration, organizations cost extra.

### 2.4 Summary comparison

| | Firebase | Supabase | Clerk | **Us** |
|---|---|---|---|---|
| Free MAU | 50K | 50K | 50K (MRU) | **50K** |
| Paid per MAU | $0.0055 → $0.0025 | $0.00325 | $0.02 | **$0.0025 flat** |
| Access token lifetime | 60 min | 60 min | 60 s | **5 min default (60 s to 60 min)** |
| Signing | RS256 | HS256 legacy / asym. | RS256 | **ES256 per project, KMS-backed, auto-rotate** |
| Web session storage | client storage | client storage (or cookie w/ SSR helpers) | first-party HttpOnly cookies | **first-party HttpOnly cookies (default)** |
| Refresh token rotation + reuse detection | partial | yes | yes (client token rotation) | **yes** |
| Managed email w/ custom domain | limited | BYO SMTP | yes | **yes (SES-backed, templates, custom domain)** |
| Managed SMS | yes (Google) | BYO | yes | **yes (multi-provider, cost caps, pumping protection)** |
| Passkeys | limited | yes (paid tiers) | yes (Pro) | **yes, free, promoted as default** |
| **UI model** | FirebaseUI (aging) | Auth UI (community, deprecated) | excellent components | **headless by design, we ship none (§1.1)** |
| Platforms | very broad | JS-centric + Flutter/Swift/Kotlin | JS-centric + RN/Expo/Flutter (beta) | **broad, tiered, spec-driven** |
| Data residency | region selection | region per project | limited | **not offered (§4.13.5)** |
| Compliance posture | Google-wide certs | SOC 2, HIPAA on paid | SOC 2, HIPAA | **architecture ready, uncertified (§4.13)** |
| Organizations / B2B | via custom claims | none | excellent | Phase 2 |

The UI row is the honest one: on that line we are worse than Clerk and we intend to stay worse, because the row below it and the price row are what we chose to buy with the saved effort.

---

## 3. Product Scope

### 3.1 Authentication methods

| Method | Free tier | Notes |
|---|---|---|
| Email + password | ✅ | Argon2id, breached-password check. Email delivery for verification/reset is metered (see §5). |
| OAuth / social (Google, Apple, GitHub, Microsoft, Facebook, Discord, X, Twitch, LinkedIn, GitLab, Bitbucket, Slack, Spotify, Notion, Figma, Kakao, LINE, Zoom, …) | ✅ | Authorization-code + PKCE only. Our API handles the redirect dance and returns the user to a customer-registered URL; no page of ours is rendered. **Pre-configured "instant" mode** for dev: our shared OAuth app so it works in 30 seconds; production requires the customer's own client credentials (a guided wizard with exact console screenshots per provider). |
| Passkeys / WebAuthn | ✅ | Promoted as the default passwordless method (zero delivery cost). The ceremony is driven by the SDK against our challenge endpoints; the browser renders the prompt, not us. |
| Anonymous / guest | ✅ | Upgradable to full accounts (games!). |
| **Email OTP** | 💲 | **The default passwordless flow.** Metered per email sent. No page needed anywhere; the code is typed into the customer's own form. |
| Magic link | 💲 | Supported, but redirects into the customer's application (§4.7). Metered per email sent. |
| SMS OTP / phone sign-in | 💲 | Metered per SMS at regional pass-through rate + margin. |
| WhatsApp OTP | 💲 | ~10× cheaper than SMS in most regions; offered as a channel. |
| TOTP MFA (authenticator app) | ✅ | Enrolment returns an `otpauth://` URI and the raw secret; the customer's app renders the QR code with their own library. |
| Passkey as MFA / step-up | ✅ | |
| SMS MFA | 💲 | |
| Recovery codes | ✅ | |
| OIDC generic provider | ✅ | |
| SAML / Enterprise SSO | 💲 (Phase 2) | Per-SSO-MAU price like competitors (~$0.01). |
| Custom token / server-minted sessions | ✅ | For migrating existing auth systems. |
| Native Sign in with Apple / Google (ID-token exchange) | ✅ | Critical for iOS/Android/Flutter/Unity. |

### 3.2 Platform features

- **Headless SDK primitives** for every flow above: typed methods, reactive session state, framework-idiomatic hooks/composables/stores, and middleware for route protection and SSR session reading. This is the product surface that replaces hosted pages and components (§1.1).
- **Dashboard**: users, sessions, devices, audit log, providers, templates, domains, keys, webhooks, usage/billing, team members with roles, 2FA required for dashboard staff. Delivered as the `client` Nuxt panel (§10). This is our own console, not something a customer's end user ever sees.
- **Internal operator console**: tenancy administration, abuse response, spend caps, provider routing, incident tooling. Delivered as the `admin` Nuxt panel (§10), never exposed to customers.
- **Management API** (server-side): CRUD users, impersonation (audited, time-boxed), bulk import (Firebase/Supabase/Auth0/Clerk export formats + bcrypt/scrypt/argon2 hash import), export.
- **Webhooks** (HMAC-signed, retried, replay-safe) for `user.created`, `user.updated`, `session.created`, `email.bounced`, …
- **Hooks** (synchronous HTTP): before-sign-up, before-sign-in, customize-claims, send-email-override, send-sms-override.
- **Email template studio** (see §11). Email is content we send on the customer's behalf, not a web UI, and it stays in scope.
- **Session & device management**: list/revoke sessions, "sign out everywhere", device names, geo, last seen.
- **Security center**: breached-password alerts, impossible-travel alerts, bot/attack dashboards, cost caps for SMS.
- **Localization** of emails and SMS templates in 30+ languages, per-project overrides. (There is no UI of ours to localize; error codes are stable and machine-readable so the customer localizes messages in their own catalogue.)
- **Migration tooling** from Firebase, Supabase, Auth0, Clerk, Cognito.
- **Data-subject-request tooling**: export, erasure, portability and rectification as first-class API operations with tracked due dates (§4.13.6).

### 3.3 SDK matrix

Everything is built on one **public HTTP API + published OpenAPI spec + a formal "Session Protocol" document**. SDKs are thin, generated-then-hand-polished clients so behaviour is identical everywhere.

Because we ship no components, an SDK's job is small and precisely specified: drive the protocol, hold the session, refresh tokens, store credentials securely for the platform, and surface stable error codes. That is why the matrix can be this broad with a team this size.

| Tier | Platforms | Notes |
|---|---|---|
| **Tier 1 (launch)** | JS core (`@idenzy/js`), React, Next.js (App Router + middleware helper), Vue, Nuxt, Svelte/SvelteKit, Flutter (Dart), iOS (Swift), Android (Kotlin), React Native / Expo | Headless clients: hooks, composables, stores, framework middleware. **No rendered components.** |
| **Tier 2 (launch + 2 to 3 months)** | Angular, SolidJS, Astro, Remix, Unity (C#), Godot (GDScript + C#), Kotlin Multiplatform, Electron, Tauri, Capacitor | Same client surface. No UI toolkit dependency, so game engines are first-class rather than an afterthought. |
| **Server SDKs** | Node, Python, PHP, Ruby, Java/Kotlin, .NET, Rust, Deno/Bun, Cloudflare Workers | JWKS verification (cached), webhook verification, management API. Middleware for Express/Fastify/Hono/NestJS, Django/FastAPI, Laravel, Rails, Spring, ASP.NET. |
| **Edge/SSR helpers** | Next, Nuxt, SvelteKit, Remix, Astro | Cookie-based session reading without network calls. |

Every SDK follows the same lifecycle: `init(publishableKey) → signIn* → session events → getToken() → signOut()`; identical error codes; identical storage security rules (Keychain / Keystore / SecureStore / HttpOnly cookies).

Because our backend is TypeScript, the **Node server SDK and the Nuxt/Next SSR helpers share the exact protocol types** exported by `@idenzy/protocol` (§8), the same compiled definitions the server uses to validate requests. Non-TS SDKs are generated from the same OpenAPI document, so the JS advantage is convenience, never a behavioural divergence.

**Starter templates, not components.** Each Tier-1 SDK ships with a `examples/` directory and a `idenzy init` template containing working sign-in, sign-up, OTP and OAuth routes written in that framework's idiom. The customer copies them into their repository and owns them outright. This is documentation with a build step, not a published component. The distinction that keeps §1.1 honest is that we never ship a versioned artifact whose job is to render auth UI.

---
## 4. Security Architecture (the most important section)

Design principle: **the customer cannot make a security mistake by accident.** Defaults are strict, dangerous options require an explicit "I understand" toggle, and everything is documented against OWASP ASVS Level 2 (target L3 for the core).

### 4.1 Threat model (what we defend against)

1. Token theft via XSS in the customer's app.
2. Refresh-token replay and session hijacking.
3. Credential stuffing, password spraying, brute force.
4. Account enumeration and timing attacks.
5. OAuth attacks: CSRF, code injection, redirect manipulation, mix-up attacks, IdP account takeover via unverified email.
6. Magic-link pre-fetching by mail scanners; OTP phishing.
7. SMS pumping and toll fraud (a real financial risk for us).
8. Multi-tenant data leakage.
9. Insider and operator risk; key compromise.
10. Supply-chain attacks on SDKs, heightened on npm; see §7.6 for the dependency and publishing controls this stack requires.
11. Bots and abuse of the free tier.

One threat class is **absent by construction**: we render no HTML on any customer-facing surface, so XSS, clickjacking, CSS injection and open-redirect-via-template against *our* pages do not exist. Threat 1 is about XSS in the customer's app, which we mitigate by never putting a token where their JavaScript can persist it (§4.3).

### 4.2 Token and session model

```
+------------+   sign-in    +-----------------+
|  Client    | -----------> |  Auth API       |
| (SDK)      | <----------- |  NestJS/Fastify |
+------------+  session +   |  (Cloud Run)    |
      |         tokens      +-----------------+
      |                             |
      |                             v
      |                    sessions / refresh_tokens (Postgres)
      |                    signing keys (Cloud KMS, per project)
      v
  Customer backend verifies access token offline via JWKS
```

- **Server-side session record** for every login: `session_id`, user, device, IP, UA, created, last_active, expires (idle timeout and absolute lifetime, both configurable). Revocable individually or in bulk.
- **Access token**: JWT, **ES256** (P-256), signed with a **per-project key pair** stored in **Cloud KMS** (HSM protection level for paid tiers). Claims: `iss` (`https://auth.customer.com`), `sub`, `sid`, `aud` (project), `iat`, `exp`, `amr` (auth methods), `acr`, `fva` (factor verification age), `auth_time` (when the session was signed in to; a refresh does not move it), custom claims from hooks. Default TTL **5 minutes**; customer configurable from 60 s to 60 min.
- **Refresh token**: 256-bit random, opaque, stored **hashed (SHA-256)**, **rotated on every use**, with **family-based reuse detection**. Using an already-rotated token revokes the whole family and session and emits a security event. Bound to the session and optionally to a device key (proof-of-possession for mobile; see §4.4).
- **Revocation latency**: a small **revocation set** (sessions revoked in the last `max_ttl`, plus a per-user watermark for bulk revocations) is held in Valkey and published as a signed snapshot on a **secret-key** endpoint with an `ETag`; server SDKs poll it and check an in-process copy, so revocation is near-instant even with 5-minute tokens and costs nothing on their request path. It is not public: the payload names users and times their security events, and a project id travels in every access token (ADR-0009). Customers who want Clerk-style 60 s tokens just set TTL=60.
- **Signing keys** (ADR-0021): one ES256 key per project, generated in the process on first use and stored wrapped by the deployment's Cloud KMS key, with the project id as authenticated data. A process unwraps a project's key once and signs locally (microseconds, no KMS call per token). Rotation (every 90 days, two keys published during the overlap, `kid` in headers, an emergency button) is still to build on top of it.
- **JWKS endpoint** per project: `/v1/projects/{prj}/jwks.json`. A verifier needs three facts — that URL, the issuer and the audience (the project) — so any off-the-shelf JWT library verifies our tokens. There is no deployment-wide JWKS or OIDC discovery document: with a key per project, neither could be right for more than one.

**Implementation note (crypto in Node).** All primitives come from `node:crypto` (WebCrypto/OpenSSL-backed) or KMS, never from a hand-rolled or unaudited userland package. Random values use `crypto.randomBytes`; comparisons use `crypto.timingSafeEqual`; Argon2id uses a native binding (`argon2`) pinned by digest. CPU-bound hashing runs on a bounded worker-thread pool (§9.6) so the event loop is never blocked by a password verification.

### 4.3 Web: first-party cookie model

- Customer maps `auth.customer.com` by CNAME to our global load balancer (Certificate Manager issues the TLS cert automatically via DNS authorization). **This is a precondition, not a convenience.** `SameSite` is a *site* rule, so `app.customer.com` to `auth.customer.com` is same-site and the cookie flows, while `app.customer.com` to our shared API host is cross-site and it never will. On the shared host, header mode is the only mode. Localhost is the development exception.
- Two cookies, both `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain` attribute leakage. `__Host-idenzy-refresh` holds an opaque session reference and never the JWT. `__Host-idenzy-session` holds the short-lived access token, so an SSR helper verifies it offline against a cached JWKS and renders with **no network call**, which is what §3.3 promises. The cost is stated where it belongs: an offline verifier cannot see a revocation until that token expires, which is what the revocation set (§4.2) exists to fix and why the default TTL is five minutes.
- Access token is delivered to the app's JS only in memory, never `localStorage`, or read server-side by SSR helpers from the cookie via the session exchange endpoint.
- **CSRF**: three defences, each sufficient against a browser on its own and none costing a round trip. `SameSite=Lax`, so another site's request never carries the cookies. Cookie mode is declared only by the custom `X-Idenzy-Session-Transport` header, so every cookie-mode request is preflighted and the browser sends nothing unless our CORS answer names the page's origin. And on every write the server requires an allowlisted `Origin` and a Fetch-Metadata value that isn't cross-site. There is no double-submit token: the page (`app.customer.com`) can never read a cookie of the auth host (`auth.customer.com`), so one could not work in the very setup cookie mode is for, and it guarded nothing the allowlisted Origin does not.
- Cross-subdomain and cross-origin SPA setups are supported through a documented "token in Authorization header" mode, labeled as such and with strict CORS allowlists. A client declares its mode per request with `X-Idenzy-Session-Transport`, because one project serves a web app and a mobile app that cannot want the same thing. Asking for cookie mode where it cannot work is refused plainly rather than granted and silently dropped.
- The project is named by `X-Idenzy-Publishable-Key`, checked before `Authorization` and with `Host` as the last fallback. It is **first-present-wins, not a fallback chain**: a header that is present but unresolvable is a hard failure, because falling through to `Host` would let a request that named one project execute against another. The header takes publishable keys only, and a secret key in it is refused on the prefix alone, before any lookup, so it cannot be used to validate a stolen secret key from a browser.
- Browser origins are their own exact-match allowlist per project (`project_origins`), derived from nothing (ADR-0006).
- **The auth API returns JSON and HTTP redirects only. It never returns HTML.** A `Content-Type` of `text/html` from an auth endpoint is a bug, and there is a test asserting it. This is what makes the headless decision a security property rather than only a product one: the customer's Content-Security-Policy governs the sign-in page, and no script of ours runs on it.

### 4.4 Mobile and desktop

- Tokens in **Keychain (iOS, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`)**, **Android Keystore-encrypted storage**, Expo SecureStore, and Unity/Godot via platform-native plugins (fallback: encrypted file with an OS-provided key).
- OAuth via **ASWebAuthenticationSession** and **Custom Tabs** with **PKCE**, never embedded WebViews.
- **Native Sign in with Apple and Google** through an ID-token exchange endpoint that verifies nonce, audience and issuer.
- **App attestation** (App Attest, Play Integrity) as an optional gate for sensitive endpoints such as sign-up and SMS send. This massively reduces SMS pumping and bot sign-ups on mobile.
- Optional **device-bound refresh tokens**: the SDK generates a key pair in the Secure Enclave or Keystore and signs refresh requests. A stolen refresh token without the device key is useless.
- Universal Links and App Links for magic-link returns and OAuth returns.

### 4.5 Passwords and credentials

- **Argon2id** (memory 64 MB, t=3, p=1, tuned per hardware and versioned in the hash so we can upgrade transparently), with a pepper stored in KMS.
- **Breached-password check** at sign-up and reset via the HIBP k-anonymity range API, so only 5 hex characters ever leave our system.
- Min length 8, max 256, no composition rules (NIST 800-63B), Unicode normalization.
- Per-account and per-IP adaptive rate limiting with exponential backoff. **No account lockout by default**, because lockout is a denial-of-service vector against the victim; optional lockout with self-unlock via email is available.
- Constant-time comparisons; identical responses for "user not found" and "wrong password"; identical timing via a dummy hash on missing users.
- Password reset: single-use, 15-minute, hashed token; invalidates all other reset tokens; optional "sign out other sessions on reset".
- Email change requires re-authentication (recent `fva`) and confirmation on **both** the old and the new address.

### 4.6 OAuth and social sign-in hardening

- Authorization code with PKCE (S256) always; `state` bound to the client session; `nonce` for OIDC; exact-match redirect URI allowlist per project (no wildcards, except an explicit dev-mode `localhost`).
- **PKCE also applies to our own exchange codes, for OAuth and deliberately not for magic links.** A link is started in one browser and clicked in another, often a mail client's, so a verifier held by the starting browser would fail the normal case every time. The column is nullable and the rule is verify-if-and-only-if-a-challenge-was-stored; magic links are carried by single use, a two-minute life and a redirect pinned at issue.
- Provider-issuer validation prevents mix-up attacks.
- **Account linking rules**: auto-link only when the provider asserts `email_verified=true`, otherwise require proof via email OTP. Configurable per project. This single rule prevents the most common IdP-based account takeover.
- Provider access and refresh tokens are stored with envelope encryption (KMS-wrapped DEK per project) and only when the customer opts in ("I need the provider token").
- "Instant dev mode" shared OAuth apps are allowed only for `localhost` and `*.idenzy.io` preview domains, show our brand on the consent screen, and are blocked for production custom domains.

**Where the redirect lands.** Our `/oauth/{provider}/start` and `/oauth/{provider}/callback` endpoints do the full dance and then `302` the browser to a redirect URI the customer registered, carrying a single-use authorization code. The SDK exchanges that code for a session. We render nothing at any point in the flow; the only HTML involved belongs to the identity provider.

### 4.7 Passwordless: OTP first, links second

**Email and SMS OTP codes are the default**, and this is a security preference before it is a product one: a code typed into the page the user is already looking at cannot be pre-consumed by a mail scanner, cannot be forwarded and clicked by an attacker, and cannot land the user in a different browser or device context than the one they started in.

- OTPs are cryptographically random, hashed at rest, limited to 5 attempts, expire in 10 minutes, and are bound to the originating flow and session.
- **Magic links** remain available for teams that want them, and they work like this: the link points at our API, which validates the token and `302`s to a customer-registered URL carrying a single-use code that the SDK exchanges for a session. **The anti-scanner confirmation click becomes a route in the customer's application**, which is exactly where it belongs, since only they can make it look like their product. The link token is single-use, hashed and valid for 10 minutes.
- Because we do not render the confirmation step ourselves, the customer's quickstart includes that route, and the SDK exposes a one-call helper for it.
- Sender authentication: SPF, DKIM (2048-bit) and DMARC `p=reject` on our shared domains, with customer domains guided to the same.
- Passkeys: full WebAuthn L3, resident keys, user verification required for passwordless, attestation optional, conditional UI (autofill) on the web. The browser renders the prompt; we supply challenges and verify assertions.

### 4.8 SMS abuse and fraud (protects our margin)

- SMS is sent only after **CAPTCHA or attestation** (reCAPTCHA Enterprise or Turnstile on web, App Attest or Play Integrity on mobile).
- Per-project **country allowlist** (default: the customer's home region plus explicit opt-in per country), per-number velocity limits, per-IP limits, and a per-project **daily spend cap** with alerts and a hard stop.
- Pumping detection: bursts of sequential numbers, a single carrier prefix, or a high send-to-verify ratio trigger automatic throttling, an alert, and provider-side fraud guards where available.
- Prefer WhatsApp or voice fallback in high-cost regions.

### 4.9 Bot and abuse protection

- Cloud Armor WAF (OWASP preconfigured rules), edge rate-limit rules (per IP, per project), adaptive protection for L7 DDoS.
- Application-level rate limits in Valkey: per identifier, per IP, per project, per endpoint.
- Free-tier abuse: project verification (email and phone for the creator), a quota on projects per account, anomaly detection on MAU spikes.
- Impossible-travel and new-device signals trigger optional step-up MFA or an email notification ("new sign-in from...").

### 4.10 Multi-tenancy and data isolation

- One Postgres database with `project_id` on every tenant row. Isolation is enforced **in the repository layer**: `BaseRepository` cannot be constructed without a `TenantContext` and every query starts from its `project_id` predicate, `OrgRepository` does the same one scope up with `org_id`.
- **This was two lines and is now one.** Every tenant table used to be `FORCE ROW LEVEL SECURITY` with a policy keyed on `current_setting('app.project_id')`, set per transaction by a role created `NOBYPASSRLS`, so the database returned nothing for a wrongly-scoped query whatever the application asked for. That was removed deliberately (2026-09-21) to collapse the schema to one plane. The audit that preceded it found 232 of 233 statements already filtering in SQL and fixed the one that did not — so the surviving line is the one that was always doing the work, but a missed predicate in a new repository is now a cross-tenant read with nothing behind it.
- Per-project signing keys and per-project encryption DEKs: compromising one project's key exposes nothing else.
- **Data residency is not offered.** One deployment in one region serves every customer. A project cannot be pinned to a jurisdiction, and nothing in this document should be read as saying it can (§4.13.5).
- Deletion: hard delete with tombstones for audit; GDPR export and delete APIs (§4.13.6).
- Tenant context propagation is a framework concern, not a developer concern. A request-scoped `TenantContext` sets `app.project_id` on the connection for the life of the transaction (§9.4), and a repository cannot be constructed without one.

### 4.11 Platform and operational security

- **Zero static credentials**: Workload Identity everywhere, no service-account keys, no long-lived API keys for staff.
- All secrets in Secret Manager; KMS with separation of duties (key admins are not key users); CMEK available on Cloud SQL and storage (§4.13.4).
- Immutable, signed container images (Binary Authorization), SLSA-3 build provenance, published SBOMs.
- SDK packages signed (npm provenance, Sigstore, Apple and Android artifact signing), reproducible builds.
- Full **audit log** (who, what, when, IP) for every dashboard and management-API action, exported to the customer (§4.13.3).
- Least-privilege VPC: Cloud SQL on private IP only, Cloud Run egress via Direct VPC, no public database.
- Secure SDLC: SAST and DAST in CI, dependency scanning, mandatory code review, threat-model review for every new auth flow, annual third-party pen test, public bug bounty, `security.txt`.
- Incident response runbooks: key compromise (emergency rotation, mass session revoke), provider outage (failover), data breach (notification timelines).
- Compliance roadmap and the architecture that supports it: §4.13.

### 4.12 Things we deliberately do not offer

- Implicit and hybrid OAuth flows, and ROPC (the password grant).
- Tokens in `localStorage` as a default.
- Non-expiring API tokens.
- HS256 with shared secrets, except as an explicit, time-boxed legacy-compat option for migrations.
- Security questions.
- **Any UI**: hosted pages, embeddable components, widgets or iframes (§1.1).

---

### 4.13 Compliance architecture (available now, certified later)

**Read this section correctly.** Idenzy holds no certification and makes no compliance claim today. What follows is the *architecture* that makes SOC 2 Type II, ISO 27001, a GDPR DPA and a HIPAA BAA reachable later as an audit rather than a rebuild. The distinction matters commercially (an enterprise buyer's security questionnaire asks about controls, not certificates) and technically: retrofitting data classification, audit integrity and residency into a live auth database is a quarter-long migration, while designing them in costs days.

The scope of §4.13 is the **data architecture**. The organizational half of every framework listed below (policies, training, risk registers, vendor reviews, an appointed DPO) is deliberately out of scope until we choose to pursue certification, and §4.13.10 says so plainly.

#### 4.13.1 What each framework demands, and where it lands

| Framework | What it demands of the architecture | Where it lives in this codebase |
|---|---|---|
| **SOC 2 Type II** (year 1) | Evidence *over time* for access control, change management, monitoring, and incident response | Hash-chained audit trail (§4.13.3), `staff_access_grants` (§4.13.7), signed images and CI-only publishing (§4.11, §7.6), evidence artifacts per release (§4.13.9) |
| **ISO 27001** | An asset and data inventory, documented controls, a supplier register | Data map generated from the schema (§4.13.2), `docs/compliance/controls.md`, `docs/compliance/subprocessors.md` |
| **GDPR** (DPA) | Lawful basis and purpose per field, Art.30 records, data-subject rights within **one calendar month** (Art. 12(3) — not 30 days), residency, sub-processor transparency, 72-hour breach notification | Column-level purpose tags generating the RoPA (§4.13.2), `data_subject_requests` carrying its `deadline_rule` and a due date computed from it (§4.13.6). **Residency is not satisfied and is not offered** (§4.13.5). |
| **US state privacy** (CCPA/CPRA and the ~20 states that follow it) | Access, deletion and correction rights on a 45-day clock extendable by 45; service-provider contract terms; no sale or sharing of personal information | `DsrDeadline` is a per-request family rather than a per-cell setting, so a state whose clock differs is a subclass and not a migration (`docs/compliance/us-and-eu-readiness.md`) |
| **HIPAA** (BAA, enterprise) | BAA scoping, PHI encryption, minimum necessary access, 6-year audit retention, no PHI in logs | `projects.compliance_tier`, field-level envelope encryption (§4.13.4), log allowlist (§4.13.8), tier-driven retention (§4.13.3) |

An auth platform holds an unusually sensitive slice of personal data (identifiers, credentials, IP addresses, device fingerprints, login times and locations) while holding very little of it per user. That shape is why classification per column, rather than per table or per service, is the right granularity.

#### 4.13.2 Classification lives in the schema, and everything else is generated

This is the keystone decision of the whole section.

Every column in the Drizzle schema is declared through a typed wrapper that carries its classification, its processing purpose and its retention rule:

```ts
export const users = classifiedTable("users", {
  email: classified(text("email"), {
    class: DataClass.Pii,
    purpose: Purpose.Authentication,
    retention: Retention.UntilAccountDeletion,
    subjectField: true,           // returned by a data-subject access request
    erasure: Erasure.Tombstone,   // erasure replaces it, keeps the row for audit integrity
  }),
});
```

`classified()` returns a *branded* column builder, and `classifiedTable` accepts only
branded builders. An unclassified column is therefore a **compile error**, not a lint
warning:

```
Property '[CLASSIFIED]' is missing in type 'PgTextBuilder<...>'
```

That distinction matters. A lint rule can be defeated by an aliased import or an unusual
call shape; a type cannot.

From that single declaration we **generate** four artifacts that would otherwise drift apart:

1. the GDPR Article 30 record of processing (`docs/compliance/ropa.md`),
2. the data map and inventory that ISO 27001 asks for (`docs/compliance/data-map.md`),
3. the Pino redaction allowlist, so a PII column is structurally unloggable (§4.13.8),
4. the field lists that data-subject export and erasure operate on (§4.13.6).

The properties this buys are worth naming. A new column **cannot escape classification**, because the type system rejects it. The compliance documentation **cannot go stale**, because it is a build output, not a document someone maintains. And a data-subject export **cannot silently miss a field**, because it reads the same source the schema does.

A generated document is regenerated in CI and the build fails if the committed copy differs, exactly like a lockfile.

#### 4.13.3 Audit trail: append-only and tamper-evident

- The runtime role `idenzy_app` is granted `INSERT` and `SELECT` on `audit_events` and **is granted no `UPDATE` or `DELETE` at all**. No application code path can rewrite a live project's history, because the privilege to do so does not exist on the connection. **One exception exists and is deliberate**: `purge_project` is `SECURITY DEFINER` and does delete audit rows, because a processor has to be able to dispose of a controller's data at the end of service (GDPR Art. 28(3)(g)) and an orphaned trail nobody can reach is a storage-limitation breach rather than a safeguard. It is narrow in the way that matters — the only rows it can remove belong to a project it deletes in the same statement, so it cannot be used to edit the past of a tenant that still exists — and it writes a `project_purges` row, so the deletion is itself on the record.
- Each project's audit stream is a **hash chain**: every row stores `prev_hash` and `entry_hash = H(prev_hash || canonical(entry))`. Tampering by anyone who does hold direct database access (an operator, a restored backup, an attacker with the owner role) is therefore detectable by verifying the chain, and a periodic verifier job does exactly that.
- Partitioned by month, so retention is enforced by dropping partitions rather than by mass deletes.
- Retention is driven by `projects.compliance_tier`: 1 year standard, **6 years for HIPAA**, configurable upward for enterprise.
- Exportable by the customer through the management API, which is what turns our audit trail into evidence for *their* audit as well as ours.
- Every entry records actor type, actor id, action, target, IP, user agent and a trace id, so an auditor's "who touched this account and when" is one indexed query.

#### 4.13.4 Encryption and key custody

- Encryption at rest is provided by Cloud SQL and Cloud Storage by default. **CMEK** (customer-managed keys) is a Terraform variable, present and off, so enabling it for an enterprise cell is a configuration change and not a migration.
- Above that, **field-level envelope encryption** for the columns that need it: a per-project DEK, wrapped by a per-cell KMS KEK, applied through a `FieldEncryptor` class in `@idenzy/crypto` and declared in the schema with an `encrypted()` wrapper. Provider OAuth tokens, TOTP secrets and any column a HIPAA-tier project marks as PHI go through it.
- Key custody follows §4.11: keys never leave KMS, key administrators are not key users, and every signing and unwrapping call is recorded in Cloud Audit Logs. That separation is a SOC 2 control and a HIPAA requirement, and it is enforced by IAM rather than by policy.
- Per-project DEKs mean a key compromise has a blast radius of one tenant.

#### 4.13.5 Residency

**Not offered.** One deployment, in one region, for every customer.

This section used to describe region cells: a `region_cells` registry of independent stacks, `cell_id` immutable on `orgs` and `projects` behind a trigger, routing that refused cross-cell access on the key before any lookup, and a global control plane holding billing identifiers only so that an EU project could be honestly described as EU-resident. All of it was built and all of it was removed on 2026-09-21, because the machinery cost more every day than the feature was worth before it had a customer asking for it.

What that means, stated plainly rather than left to be inferred:

- A customer cannot choose where their data lives, and we must not imply otherwise in copy, in a questionnaire, or in the panel.
- The competitive line in §2.4 that named residency as our answer to Firebase and Supabase no longer holds, and §15 no longer has it as a moat.
- Every EEA customer's data reaches one region. The transfer obligations that follow are recorded in `docs/compliance/subprocessors.md`.
- Bringing it back is a deployment-topology decision long before it is a schema one. The `cell_id` columns, the registry and the cross-cell refusal were the cheap half; the second stack was never provisioned.

#### 4.13.6 Data-subject rights and retention

- `data_subject_requests(id, project_id, subject_user_id, kind, status, requested_at, due_at, completed_at, artifact_uri, requested_by)` where `kind` is one of access, erasure, portability or rectification.
- `due_at` is computed at intake (30 days for GDPR), and an overdue request **pages someone**. The regulatory clock is a monitored system property rather than a calendar reminder, which is the difference between a control and an intention.
- A worker executes each request against the field lists generated in §4.13.2, so export and erasure automatically cover new columns.
- Erasure honours the tension between "erase this person" and "keep the audit trail intact": classified fields are tombstoned in place, the user row survives as a shell with a `deleted_at` and no personal data, and audit entries keep the pseudonymous user id. This is the standard reconciliation of GDPR Art.17 with Art.17(3)(b), and it is written into the schema rather than decided per incident.
- `retention_policies(project_id, subject, max_age, action)` drives scheduled purges of sessions, OTP challenges, `oauth_flows`, audit partitions and soft-deleted users. Retention that is not enforced by a job is not retention.

#### 4.13.7 Access, separation of duties and break-glass

- Staff access to production data is **deny by default**. Elevation is a `staff_access_grants(staff_id, scope, granted_by, reason, expires_at)` row: time-boxed, reason-required, granted by someone other than the requester, and expiring on its own.
- Customer impersonation is the sharpest tool we have. It is time-boxed, reason-required, written to the customer's own audit log (not only ours), and surfaceable to them as a webhook, so the customer can see us look at their tenant.
- A quarterly access review, which is an explicit SOC 2 ask, is a query over `staff_access_grants` rather than a spreadsheet exercise.
- Break-glass access exists, requires two people, and generates a high-severity alert on use.

#### 4.13.8 Log hygiene

Structured logging uses an **allowlist, not a blocklist**: a field must be declared loggable to appear, and anything undeclared is dropped before it reaches the transport. Blocklists fail silently the day someone adds a column; allowlists fail closed.

The allowlist is generated from the classification map (§4.13.2), so a column marked PII or PHI is structurally unloggable, and a lint rule rejects direct logger calls that pass an unclassified object. This is what makes "no PHI in logs", a hard HIPAA requirement, a property of the build rather than a rule people remember.

#### 4.13.9 Evidence generation

Auditors ask for evidence produced continuously, not assembled retroactively. Each release therefore emits, from CI, into `compliance/evidence/`:

- a CycloneDX SBOM and build provenance attestation,
- the dependency advisory report,
- test results and coverage,
- the migration diff applied to production,
- the regenerated data map and RoPA,
- the access review extract.

None of this is a certification. It is the artifact set an auditor asks for, produced as a side effect of shipping, so that the year-one SOC 2 engagement is an examination of records that already exist.

#### 4.13.10 Deliberately deferred

To keep this section honest, the following are **not** being done now and are not implied by anything above: the certifications and audits themselves, appointing a DPO, maintaining a formal risk register, a recurring pen-test cadence beyond the pre-launch test in §14, vendor security questionnaires, security awareness training, and the customer-facing trust portal.

The architecture is in place. The programme is not started. Nothing in this document should be quoted to a customer as a compliance claim.

---
## 5. Pricing & Unit Economics

### 5.1 Price list

| Item | Price |
|---|---|
| MAU 0 to 50,000 | Free (every **organisation**, forever) |
| MAU 50,000 to 250,000 | **$0.003 / MAU** |
| MAU 250,000 to 1,000,000 | **$0.0025 / MAU** |
| MAU above 1,000,000 | **$0.002 / MAU** |
| How the bands apply | **Marginal**, like tax brackets: an organisation at 1M pays nothing on its first 50,000, $0.003 on the next 200,000 and $0.0025 on the 750,000 after that — $2,475. Not a single rate chosen by total volume. The allowance and the bands are the organisation's rather than each project's, because the wallet is and because a free tier per project is bought by splitting one project into ten (ADR-0014). |
| MAU definition | A user who authenticated (sign-in, token refresh, or session exchange) at least once in the calendar month. **First-day-free**: a user created and never seen again after day 1 is not billed (Clerk's MRU idea). Anonymous users count only when upgraded. |
| Transactional email (verification, reset, magic link, OTP, security notices) | **$0.50 per 1,000** on our shared domain; custom sending domain: $5/mo/domain plus $0.40 per 1,000. BYO SES/SMTP: free. (Our cost: SES $0.10/1,000.) |
| SMS OTP | Regional wholesale cost plus **25% margin**, rounded (e.g. US around $0.012; TR, IN and DE per the provider table). Displayed transparently per country in the dashboard. BYO Twilio/Vonage: free. |
| WhatsApp OTP | Meta authentication-template rate plus 25%. |
| Enterprise SSO (SAML/OIDC) | $0.01 / SSO MAU (Phase 2) |
| Extra: HIPAA BAA, SLA 99.99%, SSO for dashboard | Enterprise contract |

No "Pro plan required for MFA, passkeys or custom domains" gates. Security features are free, because gating security is how competitors end up with insecure customers.

### 5.2 Why $0.0025 is viable

Revenue at scale (paid MAU only): 100K MAU gives $125/mo; 500K gives $1,125; 1M gives $2,375; 5M gives $12,375.

The economics only work if **marginal infrastructure cost per MAU is below roughly $0.0008** and **fixed cost per tenant is approximately zero**. Assumptions per MAU per month: about 8 sign-ins, about 150 token refreshes (5-min TTL, roughly 12 h of active use), about 2 emails. That is roughly 160 lightweight requests per MAU per month.

| Scale | Requests/mo | Cloud Run (Node/Fastify) | Cloud SQL | Valkey | LB/Armor/egress | Total |
|---|---|---|---|---|---|---|
| Launch (50K MAU or fewer) | ~10M | $55 (min-instance 1) | $60 (db-custom-1-3840) | $35 (1 GB basic) | $40 | **~$190/mo** |
| 500K MAU | 80M | $200 | $250 (2 vCPU HA) | $70 | $120 | **~$640/mo** (vs $1,125 rev) |
| 5M MAU | 800M | $1,150 | $900 (8 vCPU HA + read replica) | $200 | $600 | **~$2,850/mo** (vs $12,375 rev) |

Gross margin turns positive around 250K paid MAU and exceeds 70% at scale. Free-tier projects cost us roughly $0.0002 to $0.0005 per MAU; the 50K free tier is a customer-acquisition cost, bounded by the abuse controls in §4.8 and §4.9.

**Note on compute sizing.** A Node.js service is memory-hungry relative to the work it does per request: allocate **1 GiB per instance**, not 512 MiB, and budget a moderate CPU cost per request. The compute lines above already reflect that. It moves blended cost by well under $0.0002/MAU, inside the headroom the $0.0025 price already carries, because compute is not the dominant line here. Cloud SQL and the load balancer are. The levers below keep it that way.

Cost levers that make this possible:

1. **Fastify, not Express.** The adapter choice is a cost decision, not a taste one: significantly higher throughput per vCPU on JSON workloads, and schema-compiled serialization that avoids the reflection cost most Node stacks pay per response.
2. Cloud Run concurrency of **120 or more per instance** with an event-loop-friendly service. The hot paths (token refresh, session exchange) are I/O-bound, which is where Node is competitive with anything. CPU-bound work (Argon2, key wrapping) is pushed to a worker pool so it never serializes the loop (§9.6).
3. **Cache JWKS, project config, and rate-limit state** in Valkey. Access-token verification never hits us; token refresh is one indexed Postgres update.
4. **Single shared HA Postgres** instead of per-tenant databases. Supabase's model forces a project per tenant; ours does not. Isolation is the repository layer's (§4.10).
5. Cloud CDN for JWKS and static assets (long cache with `kid` versioning). The `landing` panel's SSR output is CDN-cached at the edge so SSR cost is amortized across visitors rather than paid per view (§10.3).
6. Async everything non-critical (email, webhooks, audit, analytics) via Pub/Sub, so request latency and CPU stay low.
7. Cold-start discipline: services are bundled to a single JS file, the dependency graph is audited, barrel-file mega-imports are banned by lint (§7.5), `NODE_OPTIONS` is tuned, and rarely-used surfaces are lazy NestJS modules. This keeps min-instances low instead of paying for warm capacity.
8. No marketing-email product (SES handles our transactional needs at $0.10/1,000).
9. **No UI to build, host, theme, localize, accessibility-audit or maintain** (§1.1). This is not a line on the infrastructure table; it is the largest single line on the *engineering* cost table, and it is the main reason a team of five can credibly ship the platform breadth in §3.3.

---

## 6. Google Cloud Architecture

### 6.1 Diagram

```
                     Internet / Customers' apps & SDKs
                                   |
                    +--------------v---------------+
                    | Global External HTTPS LB     |  Certificate Manager (customer CNAMEs)
                    | + Cloud Armor (WAF, rate lim)|  Cloud CDN (JWKS, static assets)
                    +------+---------------+-------+
                           |               |
                +----------v-------+  +----v---------------------+
                | api              |  | landing (Nuxt SSR)       |  Cloud Run
                |                  |  | client / admin (Nuxt SPA)|  + CDN/static bucket
                | NestJS + Fastify |  +--------------------------+
                +--+-----+------+--+
                   |     |      |
     +-------------v+ +--v----+ +v---------------+
     | Cloud SQL PG | |Valkey | | Cloud KMS      |
     | HA, private  | |(Memory| | per-project    |
     | IP, PITR     | | store)| | signing keys   |
     +--------------+ +-------+ +----------------+
                   |
        +----------v----------+          +----------------------+
        | Pub/Sub topics      | -------> | workers (Cloud Run,  | --> AWS SES / Twilio / WhatsApp
        | email, sms, webhook,|          | NestJS standalone)   | --> customer webhook endpoints
        | audit, analytics,   |          | email, sms, webhook, | --> BigQuery (usage & billing)
        | dsr, retention      |          | audit, dsr, retention|
        +---------------------+          +----------------------+
                                                Cloud Tasks (retries w/ backoff)
   Cross-cutting: Secret Manager, Cloud Logging/Monitoring, Uptime checks, Error Reporting,
                  Cloud Build + Artifact Registry + Binary Authorization, Terraform, Cloud Scheduler
```

Note what is absent compared to a competitor's diagram: there is no hosted-UI service, no component CDN and no theming service. The only thing we serve to a browser is our own dashboard.

### 6.2 Component decisions and rationale

| Component | Choice | Why (cost / reliability) |
|---|---|---|
| Compute | **Cloud Run** (Gen 2), Node.js LTS, 1 vCPU / 1 GiB, min instances 1 to 2 in prod, 0 in staging | Cheapest managed compute with autoscaling, per-request billing, built-in TLS, revisions and rollbacks, no cluster to run. GKE only if we outgrow it, which is unlikely before 10M+ MAU. |
| Language | **TypeScript (strict) on Node.js LTS** | One language across API, workers, SDKs, dashboards and infra tooling. This is the single largest velocity lever for a small team, and it removes the protocol-drift class of bug between server and the JS SDKs most customers use. Mature, audited JOSE (`jose`), WebAuthn (`@simplewebauthn/server`) and OIDC libraries; `node:crypto` for primitives. The cost is memory and raw CPU (§5.2) and a heavier supply-chain surface (§7.6): both are managed, neither is structural. |
| HTTP framework | **NestJS with the Fastify adapter** | NestJS gives us the class-based, DI-driven, module-boundaried architecture this project requires (§7, §9). Guards, interceptors, pipes and filters map exactly onto our cross-cutting concerns (tenancy, rate limits, audit, error shaping). Fastify underneath gives the throughput and schema-based serialization Express cannot. |
| Database | **Cloud SQL for PostgreSQL 17**, regional HA, private IP, PITR, automated backups, managed connection pooling | Battle-tested, cheapest managed relational option with HA. Spanner and AlloyDB are overkill and 3 to 5 times the cost at our scale; migrate to AlloyDB only when write throughput demands it. |
| Data access | **Drizzle** (`drizzle-orm` + `drizzle-kit`), used inside class-based repositories (§9.4) | See §9.4 and ADR-0001 for the full argument. In short: it is a typed query builder, not a runtime ORM. It has zero runtime dependencies, emits SQL we can read, models RLS policies and roles in the schema, and generates forward-only SQL migrations we review and commit. It gives compile-time column safety without hiding the database. |
| Cache / rate limits / OTP state | **Memorystore for Valkey** (1 GB basic at launch, then standard HA) | Sub-millisecond counters and TTL primitives. At launch we could use Postgres `UNLOGGED` tables to save $35/mo, but Valkey simplifies rate limiting. |
| Keys | **Cloud KMS** asymmetric EC P-256 keys (software level on free tier, HSM for paid), one key ring per region, one key per project, with rotation | Private keys never exist in application memory, and signing is audited via Cloud Audit Logs. |
| Edge | **Global external Application LB, Cloud Armor, Cloud CDN, Certificate Manager** | A single anycast IP for all customer CNAMEs, managed certs for thousands of custom domains, and WAF plus rate limiting before traffic costs us CPU. |
| Front end | **Nuxt (latest)**: `landing` SSR on Cloud Run, `admin` and `client` prerendered SPA shells on CDN/GCS (§10) | SSR only where SEO and first paint are the product (marketing and docs). The two authenticated panels are pure SPAs, which removes an entire class of server-side session handling and costs nothing to serve. |
| Async | **Pub/Sub**, **Cloud Tasks**, Cloud Run workers | Cheap, at-least-once delivery, dead-letter topics, per-task retry with backoff for webhooks. |
| Analytics / billing | **ClickHouse** (`auth_events`), queried for MAU | Isolation is a row policy plus a client that cannot exist without a tenant (ADR-0013), and it is the one place a row policy survives — ClickHouse has no `current_setting`, so the argument for it never depended on Postgres RLS. MAU is `COUNT(DISTINCT user_id)` per project per month. BigQuery was the first draft and was replaced. |
| Observability | Cloud Logging/Monitoring/Trace, OpenTelemetry (Node SDK, auto-instrumentation for Fastify, pg and Valkey), alerting to PagerDuty/Slack | Included. Structured logs (Pino) with `project_id` for customer-facing log export, field-allowlisted per §4.13.8. |
| IaC / CI | Terraform (google provider), Cloud Build to Artifact Registry to Cloud Deploy, Binary Authorization, pnpm workspace-aware build graph | Reproducible environments: dev, staging, prod-us, and prod-eu when the second cell exists. Only `environments/dev` is written today and nothing has been applied. |
| Regions | **One**, `us-central1`, with regional HA. There is no second region and no per-project region; residency is not offered (§4.13.5). | Simplicity. The multi-region story was built and removed. |

### 6.3 Reliability targets

- 99.95% API availability at launch (single region, HA SQL, multi-zone Cloud Run). 99.99% would need a second region, which no longer exists as a plan (§4.13.5).
- p95 latency: token refresh under 60 ms, sign-in under 250 ms (excluding provider round trips), JWKS from CDN under 20 ms.
- **Event-loop lag is a first-class SLO**: p99 under 20 ms per instance, alerting at 50 ms. A Node service that violates this is failing even while returning 200s, so it is monitored like an error rate rather than a nice-to-have.
- RPO of 5 minutes or better (PITR), RTO of 30 minutes or better, with a documented restore drill run quarterly. The drill record is itself compliance evidence (§4.13.9).
- Graceful degradation: if Valkey is down, fall back to Postgres rate limiting; if SES is down, fail over to the secondary email provider automatically.

### 6.4 Infra cost at launch (single cell, prod)

| Item | Monthly |
|---|---|
| Cloud Run (api 2 min instances at 1 vCPU/1 GiB, landing SSR, workers) | ~$95 |
| Cloud SQL PG HA, 2 vCPU / 8 GB, 50 GB SSD, PITR | ~$220 |
| Memorystore Valkey 1 GB basic | ~$35 |
| Global LB, Cloud Armor (standard), Certificate Manager (first 100 certs) | ~$50 |
| VPC, subnet, Private Service Access peering, data-subject export bucket | ~$0 — but only if two choices go the right way, below |
| KMS (software keys, ~10K signs/day) | ~$5 |
| Static hosting/CDN for `admin` and `client` SPA bundles | ~$5 |
| Pub/Sub, Cloud Tasks, BigQuery, Logging (within free and low tiers) | ~$30 |
| Staging (scale-to-zero, smallest SQL) | ~$60 |
| **Total** | **around $500/mo** (trimmable to about $270 by running non-HA SQL in the first weeks) |

**Stage one is one VPS, and it needs no VPC at all.** The APIs, Postgres, Valkey, ClickHouse and the workers all run on one high-end box, so nothing crosses a network between them. Google provides exactly two things, neither of them for cost: **KMS**, because key custody is the one property that cannot be rebuilt after a compromise and a signing key on the box is a signing key in every snapshot of it, and **Cloud Storage**, because a data-subject export needs retention that enforces itself. Both are outbound HTTPS calls. `infra/terraform` creates those two plus the service account the VPS authenticates as, and nothing else: everything managed sits behind `enable_managed_infrastructure`, off by default.

The paragraph below applies to the **later** stage, when a managed database is worth its cost.

**Cloud Run needs no VPC; a private Cloud SQL does.** Cloud Run's egress reaches the internet on its own, which is all SES, Twilio, Stripe and every OAuth provider need. What needs a VPC is the other direction: Cloud SQL is declared private-IP-only and Memorystore has no public endpoint at all, so private means "reachable from a VPC" and something has to be that VPC. The network, its subnet, the firewall rules and the Private Service Access peering are all free.

Two decisions around it are not free, and both are made in `infra/terraform`:

- **Direct VPC egress, not a Serverless VPC Access connector.** A connector bills per instance-hour with a minimum of two instances, whether or not a byte flows — standing cost for idle capacity. Direct egress has no such charge and draws addresses from the subnet instead, which is why it is sized /20.
- **Egress restricted to private ranges, not all traffic.** Routing everything through the VPC means private-only workloads need a Cloud NAT gateway to reach the internet, billed hourly per gateway plus per gigabyte processed. Since only Postgres and Valkey are private and every third party is public, private-ranges-only skips NAT entirely.

Taken the other way, those two add roughly the cost of the Memorystore line twice over, for nothing a customer would notice. The figures above are from §6.4's original estimate and want re-checking against the pricing calculator before anything is applied.

One line the table still lacks: **ClickHouse**. ADR-0013 replaced the BigQuery row above, and a managed or self-hosted ClickHouse is not free. It is not in this estimate.

---

## 7. Engineering Standards (normative)

This section is binding. A change that violates it does not get merged, regardless of how well it works. The point is not stylistic uniformity for its own sake. An auth platform accumulates dozens of near-identical flows (twenty OAuth providers, a dozen email templates, five MFA factor types, four delivery channels), and the only way that stays reviewable at team size 5 is if every one of them is the same shape.

### 7.1 Language rules

- **TypeScript only.** No JavaScript source files anywhere in the repo except generated output and config files that cannot be TS.
- `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`, `noFallthroughCasesInSwitch`. These are set once in `tsconfig.base.json`, every package extends it, and a package may not relax them.
- **`any` is banned** (lint error). Use `unknown` at boundaries, narrowed by a validator. Type assertions (`as`) require a comment justifying why the compiler cannot know.
- No enums-as-strings drift: domain enums are declared once in `@idenzy/protocol` and reused by server, SDKs and panels.
- Every value crossing a trust boundary (HTTP body, query, header, webhook payload, Pub/Sub message, env var, provider response) is parsed by a schema before it is typed. Types are a consequence of validation, never a substitute for it.
- ESM everywhere, `NodeNext` resolution, no CommonJS in first-party code.
- **Docstrings are short and informative.** One line saying what a thing does and why it exists, plus the non-obvious constraint if there is one. No restating the signature, no ceremony, no `@param` blocks that repeat the types.

### 7.2 The class-based mandate

**All domain logic, all infrastructure adapters, and all framework integration are expressed as classes.** Specifically:

1. **Services, repositories, providers, guards, interceptors, strategies, workers, mappers and clients are classes**, registered in a NestJS module and obtained through constructor injection. A service is never imported and called as a module-level function.
2. **Constructor injection only.** No property injection, no service locator, no importing a singleton instance from another file. If a class needs a collaborator, it appears in the constructor signature. That signature is the class's honest dependency list, and it is what tests substitute.
3. **Abstract base classes define the contracts of every family of things.** Where two or more implementations of the same idea exist, and in this product they always do, there is an `abstract class` holding the invariant logic and declaring `protected abstract` hooks for the parts that vary. Concrete subclasses implement only the variation. Families modelled this way: OAuth providers, email providers, SMS providers, MFA factors, rate-limit strategies, token issuers, hash algorithms, migration importers, webhook signers, storage backends.
4. **Inheritance for shared invariants, composition for shared capability.** A subclass exists to inherit behaviour it must not be able to skip (the audit write, the rate-limit check, the tenant assertion). Anything a class merely *uses* is injected, not inherited. Deep hierarchies are a smell: the target is base to concrete, with an intermediate layer only when a genuine sub-family exists (`OAuthProvider` to `OidcProvider` to `GoogleProvider`).
5. **Template Method is the default pattern** for flows. The base class owns the algorithm and its ordering; subclasses fill in steps. This is how we guarantee that no provider implementation can forget to validate `state`, and no delivery channel can forget the spend cap.
6. **Interfaces describe shapes; abstract classes describe behaviour.** Use an `interface` for a data structure or a purely structural port with no shared logic. Use an abstract class the moment there is one line of logic every implementer must run.
7. `readonly` on every injected dependency and every field not intentionally mutable (lint-enforced). `private` and `protected` by default; `public` is a deliberate act of API design. `override` is required (`noImplicitOverride`), so an accidental shadow is a compile error.
8. **Errors are a class hierarchy** rooted at `IdenzyError`, with a stable machine-readable `code`, an HTTP status, a safe public message and an internal detail payload. Every thrown error is an instance of a subclass; `throw new Error(...)` is a lint error. This is what makes "identical error codes across every SDK" (§3.3) enforceable rather than aspirational, and it matters more for us than for most, because the customer builds their own UI from those codes.
9. **Entities and value objects are classes with behaviour**, not anonymous records passed between functions. A `Session` knows whether it is expired, a `RefreshTokenFamily` knows what reuse means, and an `E164PhoneNumber` cannot be constructed invalid. Validation lives in the constructor or a static factory, so an instance's existence is proof of validity.
10. Pure leaf helpers (a string formatter, a comparison, a date calculation) may be plain exported functions. They must be genuinely pure and dependency-free. The moment a helper needs configuration, a clock, a logger or I/O, it becomes an injected class.

**Illustrative shape**, the base that every social provider extends:

```ts
/** Base for every social provider. Owns flow ordering and the security checks. */
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

A new provider is then about 40 lines and cannot omit a security step. That property is the whole reason for the mandate.

### 7.3 Module and dependency rules

- **Dependency direction is one-way**: `apps` to feature modules to `domain` to `protocol`/`core`. Nothing in `domain` may import from infrastructure; it depends on abstract classes that infrastructure implements. Enforced by lint rules on import paths, checked in CI (§7.5).
- Each NestJS module has an explicit public surface: what it `exports` is its API. Reaching into another module's internal file is a lint error.
- No circular imports between packages. The workspace graph must be a DAG, and CI fails on a cycle.
- Cross-cutting concerns are **never** manual calls inside handlers. Tenancy, caller authentication, rate limits, idempotency, audit and error shaping are guards, interceptors and filters applied declaratively. If a handler has to remember to call something, the design is wrong.

### 7.4 Testing

- Unit tests instantiate classes directly with fakes passed to the constructor. No framework, no mocking of module internals.
- Every abstract base class ships a **conformance test suite** exported as a reusable class, and each concrete subclass runs it. A new OAuth provider or SMS provider is not merged until it passes the family's suite. This mirrors the SDK conformance suite in §3.3, applied inward.
- Integration tests run against a real Postgres and Valkey in containers (Testcontainers). These used to include **RLS negative tests** asserting that a cross-project read failed at the database even when the repository was deliberately misused; with the policies gone those nineteen tests were deleted rather than weakened, and isolation is tested at the repository layer instead (§4.10).
- Security-critical paths (token rotation, reuse detection, OAuth callback, OTP verification, password reset) require a test that asserts the *attack* fails, not only that the happy path succeeds.
- Compliance-critical invariants are tested too: `UPDATE` and `DELETE` on `audit_events` must be rejected for the app role, the audit hash chain must verify, and a data-subject export must cover every field marked `subjectField` in the schema.
- Coverage gates: 90% on `domain`, 80% overall. Coverage is a floor, not a goal.

### 7.5 Tooling

- **pnpm** (workspaces, isolated node-linker so a package cannot use an undeclared dependency), Node LTS pinned via `.nvmrc` and `engines`.
- **Turborepo** for the task graph and remote caching (`build`, `lint`, `typecheck`, `test`, `bundle`).
- **Biome** for formatting and linting, replacing ESLint and Prettier entirely. One tool, one config, one pass over the tree, and fast enough to run on every save and in a pre-commit hook without anyone disabling it. The rules that matter to us are configured in the root `biome.json`:

  | Rule | Enforces |
  |---|---|
  | `suspicious/noExplicitAny` | the `any` ban (§7.1) |
  | `style/useReadonlyClassProperties` | `readonly` on injected dependencies (§7.2.7) |
  | `style/noRestrictedImports` | the layer boundaries of §8.3, expressed per package via `overrides` |
  | `nursery/noFloatingPromises`, `nursery/noMisusedPromises` | an unawaited audit write or outbox insert is a real bug class for us, and these are type-aware |
  | `nursery/noDrizzleDeleteWithoutWhere`, `nursery/noDrizzleUpdateWithoutWhere` | an unqualified `DELETE` on a multi-tenant table is catastrophic; Biome ships Drizzle-specific rules and we turn them on |
  | `performance/noBarrelFile`, `performance/noReExportAll` | cold-start discipline (§5.2 lever 7) |
  | `style/noProcessEnv` | environment variables are read only in `@idenzy/config`, never scattered |
  | `style/noNonNullAssertion` | `!` hides exactly the cases `noUncheckedIndexedAccess` exists to surface |
  | GritQL plugin `no-raw-throw` | `throw new Error(...)` is rejected in favour of an `IdenzyError` subclass (§7.2.8) |
  | GritQL plugin `no-unclassified-column` | a bare Drizzle column that skips `classified()`. Editor-time feedback only; the real gate is the type system (§4.13.2) |

  Biome's GritQL plugin support is what lets us express the project-specific bans as real lint errors rather than review folklore. Custom rules live in `tools/biome-plugins/`.
- **Husky** for git hooks, with **lint-staged** running `biome check --write` on staged files and **commitlint** enforcing Conventional Commits. Because the workspace sets `ignoreScripts: true` for supply-chain reasons (§7.6), the `prepare` script does not run automatically on install: run `pnpm run prepare` once after cloning, which the bootstrap script and the README both state. Hooks are a convenience that catches mistakes early; CI is the gate that actually enforces (§8.4), and no hook is allowed to be the only place a rule is checked.
- **Changesets** for versioning and publishing the public `@idenzy/*` SDK packages.
- Commit convention: Conventional Commits, machine-checked. The PR template includes a threat-model checkbox for any change touching an auth flow, and a data-classification checkbox for any change touching the schema.

### 7.6 Supply chain (the cost of choosing npm)

Moving to Node enlarges threat 10 in §4.1, so the controls are explicit:

- Lockfile committed, `pnpm install --frozen-lockfile` in CI, and **no lifecycle scripts** (`ignoreScripts: true`) with a per-package allowlist (`onlyBuiltDependencies`) for the few native builds we need (Argon2).
- These settings live in `pnpm-workspace.yaml`, **not** `.npmrc`. pnpm 11 does not read project `.npmrc` for them, so writing `ignore-scripts=true` there looks correct and silently does nothing. Verify with `pnpm config list`, and treat "the control is written down" and "the control is in effect" as different claims.
- Dependency budget: a new runtime dependency in a security-relevant package requires reviewer sign-off recorded in the PR. Prefer `node:` builtins, and prefer one audited library over three convenient ones. Drizzle's zero runtime dependencies were part of why it won ADR-0001.
- Automated advisory scanning on every PR and nightly; a CycloneDX SBOM published per release; images signed and admitted by Binary Authorization (§4.11).
- Published SDKs use **npm provenance** and are released only from CI, never from a laptop.
- Integrity-hash pinning for anything in the token-signing or password-hashing path.

---

## 8. Monorepo & Package Architecture

### 8.1 Principles

The codebase is **one pnpm workspace**. Apps are thin deployables; all reusable logic lives in packages. A package is created when code has more than one consumer, or has a boundary worth enforcing, not merely because a folder got large. Every package has its own `package.json`, `tsconfig.json`, tests and an explicit public entry point, and deep imports into another package's `src/` are forbidden.

Three package classes:

- **`@idenzy/*` public**, published to npm, semver-stable, documented: the SDKs.
- **`@idenzy/*` internal**, `private: true`, consumed only inside the workspace: domain, infrastructure, shared dashboard UI.
- **apps**, `private: true`, never imported by anything.

### 8.2 Layout

```
idenzy/
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── apps/
│   ├── api/                      # NestJS + Fastify, both surfaces: the public auth API,
│   │                             #   and dashboard/management + billing under src/management/
│   ├── workers/                  # NestJS standalone: email, sms, webhook, audit, dsr, retention
│   ├── landing/                  # Nuxt, marketing + docs shell            [SSR: ON]
│   ├── client/                   # Nuxt, customer dashboard panel          [SSR: OFF, SPA]
│   └── admin/                    # Nuxt, internal operator console         [SSR: OFF, SPA]
├── packages/
│   ├── protocol/                 # @idenzy/protocol, wire types, error codes, enums, schemas, OpenAPI source of truth
│   ├── core/                     # @idenzy/core, base classes: IdenzyError hierarchy, Clock, Logger, Result, value objects
│   ├── domain/                   # @idenzy/domain, entities, value objects, domain services, abstract ports. Zero infrastructure imports.
│   ├── crypto/                   # @idenzy/crypto, KMS signer, JWT issuer/verifier, Argon2 hasher, FieldEncryptor, worker pool
│   ├── persistence/              # @idenzy/persistence, Drizzle schema + migrations, TenantContext, UnitOfWork, BaseRepository
│   ├── compliance/               # @idenzy/compliance, data classification, RoPA/data-map generators, DSR + retention engine
│   ├── cache/                    # @idenzy/cache, Valkey client, abstract RateLimitStrategy + implementations, revocation set
│   ├── providers-oauth/          # @idenzy/providers-oauth, OAuthProvider base + ~20 concrete providers
│   ├── providers-email/          # @idenzy/providers-email, EmailProvider base + SES/Resend/Postmark/SMTP
│   ├── providers-sms/            # @idenzy/providers-sms, SmsProvider base + Twilio/AWS EUM/Vonage/MSG91/WhatsApp + routing table
│   ├── templating/               # @idenzy/templating, MJML compile, sandboxed variable binding, locale fallback chain
│   ├── messaging/                # @idenzy/messaging, Pub/Sub + Cloud Tasks abstractions, outbox, idempotency
│   ├── observability/            # @idenzy/observability, OTel bootstrap, Pino logger + allowlist, event-loop metrics, audit interceptor
│   ├── config/                   # @idenzy/config, schema-validated config classes, Secret Manager loader
│   ├── testing/                  # @idenzy/testing, fakes, fixtures, Testcontainers harness, conformance suite base classes
│   ├── ui/                       # @idenzy/ui, shared Vue components for landing/client/admin ONLY.
│   │                             #   Internal, never published, and never authentication UI (§1.1).
│   └── sdk/
│       ├── client/               # runs in a browser or on a device. DOM lib, no Node globals.
│       │                         #   Also where an SSR seed lives: it needs @idenzy/js for the
│       │                         #   snapshot shape, and only `server/` is forbidden that (§8.3).
│       │   ├── js/               # @idenzy/js         (public), the one the rest are built on
│       │   ├── react/  vue/  angular/  solid/        (public), bindings over js
│       │   ├── svelte/                               (public), plus /server, the SvelteKit handle
│       │   ├── next/  nuxt/                          (public), bindings that also render on a server
│       │   └── astro/  remix/                        (public), the SSR seed alone, no browser half
│       └── server/               # runs on a server. Verifies tokens, never holds a session.
│           ├── node/             # @idenzy/node       (public, server SDK)
│           └── nest/             # @idenzy/nest       (public, guards + module for customers on NestJS)
├── infra/
│   ├── terraform/                # LB, Cloud Run, SQL, KMS, Armor
│   └── docker/                   # Dockerfiles, distroless runtime images
├── docs/
│   ├── adr/                      # architecture decision records
│   └── compliance/               # controls map, subprocessors, generated data-map + RoPA
└── tools/
    ├── cli/                      # @idenzy/cli, `idenzy init|users import|templates pull|keys rotate`
    ├── biome-plugins/            # GritQL custom lint rules (§7.5)
    └── openapi/                  # generator: protocol to OpenAPI to non-TS SDKs
```

Every SDK package is a client library. **No package in this tree, published or internal, renders authentication UI.** `packages/ui` is the single component library and it serves only our own three panels.

### 8.3 Boundary rules

| Layer | May import | May never import |
|---|---|---|
| `protocol` | nothing first-party (the only true leaf) | anything, including `core` |
| `core` | `protocol` (for the error-code enum that `IdenzyError` carries) | everything else |
| `domain` | `protocol`, `core` | `persistence`, `cache`, `providers-*`, any app |
| `crypto`, `persistence`, `cache`, `providers-*`, `messaging`, `templating`, `compliance` | `protocol`, `core`, `domain` (to implement its abstract ports) | each other's internals, any app |
| `sdk/client/*` | `protocol`, `core`, `@idenzy/js`, and `@idenzy/node` where the framework also renders on a server | `domain`, `persistence`, `crypto`, and every other package of ours |
| `sdk/server/*` | `protocol`, `core` | any client SDK, and everything a `sdk/client/*` may never import |
| `ui` | `protocol`, `core` | `domain`, `persistence`, `sdk` internals, any app |
| apps | any package | another app |

`domain` declaring an abstract `EmailProvider` and `providers-email` extending it is the inversion that keeps this acyclic: the concrete adapter depends on the domain, never the reverse.

This table is not prose. It is transcribed directly into `biome.json` as `style/noRestrictedImports` overrides per package path, so a violation fails `pnpm lint` and therefore CI.

### 8.4 Build and release

- `turbo run build` walks the graph, and every package emits ESM plus `.d.ts`. Apps additionally bundle to a single file for cold-start (§5.2).
- Server images are distroless, non-root, read-only filesystem, with only the pruned production dependency closure (`pnpm deploy --filter`).
- Public SDKs release through Changesets on tag; internal packages are never published.
- One CI pipeline: `install` to `typecheck` to `lint` to `unit` to `build` to `integration (containers)` to `image` to `sign` to `deploy`. Turbo remote cache makes an unaffected package free.
- CI additionally regenerates the compliance artifacts (§4.13.9) and fails if the committed copies differ.

---

## 9. Backend Runtime Architecture (NestJS + Fastify)

### 9.1 Applications

| App | Shape | Notes |
|---|---|---|
| `api` | NestJS HTTP (Fastify adapter) | Public, internet-facing, per-project routing by Host header (customer CNAME). The only app that mints tokens. Returns JSON and redirects, never HTML (§4.3). Serves **both surfaces**: the public authentication API, and the dashboard/management/billing API authenticated by a dashboard access token. These were `auth-api` and `management-api`, separate deployments so that a dashboard incident could not degrade sign-in; §16 item 6 recorded the split as open and it was resolved by merging (2026-09-21). `src/http/surface.ts` decides which surface a path is on, and is what keeps the dashboard routes from inheriting the auth API's CORS policy — the auth surface allows credentials because cookie mode needs them, the dashboard surface allows none because it has none to allow. |
| `workers` | NestJS standalone (no HTTP server) | One module per consumer: email, sms, webhook, audit, analytics, plus `dsr` and `retention` (§4.13.6). Pub/Sub push endpoints where an HTTP entry is required, otherwise pull. |

All three share the same packages and the same class conventions; only the transport differs. A worker is a class with a `handle(message)` method registered in a module, not a script.

### 9.2 Module map (inside `api`)

```
AppModule
├── ConfigModule            (global, schema-validated config classes)
├── ObservabilityModule     (global: OTel, Pino, event-loop metrics, RequestContext)
├── PersistenceModule       (global: pool, TenantContext, UnitOfWork, repositories)
├── CacheModule             (global: Valkey, rate-limit strategies, revocation set)
├── CryptoModule            (KMS signer, JWKS cache, hasher worker pool, FieldEncryptor)
├── TenancyModule           (project resolution by host/key, project config cache)
├── IdentityModule          (users, identities, account linking rules)
├── SessionModule           (sessions, refresh families, reuse detection, revocation)
├── PasswordModule          (Argon2, HIBP check, reset flows)
├── OAuthModule             (flow store + OAuthProvider registry + redirect handling)
├── PasskeyModule           (WebAuthn registration/authentication ceremonies)
├── OtpModule               (email/SMS/WhatsApp challenges, the default passwordless path)
├── MfaModule               (MfaFactor hierarchy: TOTP, passkey, SMS, recovery codes)
├── HooksModule             (synchronous customer HTTP hooks, timeout + fail-closed policy)
├── EventsModule            (outbox to Pub/Sub: webhooks, audit, analytics)
└── WellKnownModule         (JWKS, OIDC discovery, CDN-cached)
```

Each module owns its controllers, its services and its own DTO schemas, and exports only the services other modules legitimately need.

### 9.3 Request pipeline

Ordered, declarative, identical for every route:

1. **Cloud Armor / LB**: WAF, edge rate limits, TLS termination (§4.9).
2. **Fastify hooks**: request id, structured log binding, body-size cap, JSON schema-compiled parse.
3. **`TenantResolutionGuard`**: resolves the project from the publishable-key header, then an API key on `Authorization`, then `Host`, first-present-wins. Loads cached project config and populates `TenantContext`. No tenant, no request.
4. **`AuthGuard` subclasses**: `PublishableKeyGuard`, `SecretKeyGuard`, `SessionGuard`, `StaffGuard`. All extend a common `BaseAuthGuard` that owns the timing-safe comparison and the failure shape.
5. **`RateLimitInterceptor`**: selects a `RateLimitStrategy` (per IP, per identifier, per project, per endpoint) declared by a decorator on the handler.
6. **`ValidationPipe`**: schema parse of params, query and body into DTO classes. Unknown fields rejected.
7. **`IdempotencyInterceptor`**: for mutating management endpoints.
8. **Controller to domain service**: the controller does nothing but translate DTO to domain and return. All logic is in injected services.
9. **`AuditInterceptor`**: records action, actor, target, IP and UA to the outbox (§4.13.3).
10. **`ExceptionFilter`**: maps the `IdenzyError` hierarchy to the public error contract from `@idenzy/protocol`. Anything unrecognized becomes a generic 500 with internal-only detail. No stack traces, no enumeration-revealing messages.

### 9.4 Persistence and tenancy (Drizzle)

**Why Drizzle, given that an earlier draft of this document banned ORMs.** The objection was never to typed data access; it was that a runtime ORM hides RLS, `SET LOCAL`, partitioning and index use behind generated queries. Drizzle does not do those things. It has no runtime client engine and no runtime dependencies, its query builder maps one-to-one onto SQL you can predict by reading the call, it models RLS policies and Postgres roles as first-class schema objects, and `drizzle-kit` emits plain SQL migration files that we review and commit rather than an opaque migration engine. We get compile-time column safety and lose nothing we cared about. The full argument, including what we gave up, is ADR-0001.

The one genuine gap is **table partitioning**, which `drizzle-kit` does not generate. Partitioned tables (`audit_events`, `sessions`) are created and maintained by hand-authored migrations produced with `drizzle-kit generate --custom`, sitting in the same numbered sequence as generated ones. This is called out because it is the kind of thing that silently rots if it is not written down.

**The tenancy mechanism:**

- Two Postgres roles. `idenzy_owner` owns the schema and runs migrations. `idenzy_app` is the runtime role and the only one the application connects as. It was created `NOBYPASSRLS` and every tenant table was `FORCE ROW LEVEL SECURITY`; both are gone with the policies (§4.10). What the split still buys is the grants — `idenzy_app` has no UPDATE or DELETE on `audit_events`, which is the integrity control of §4.13.3 and never had anything to do with RLS.
- `PersistenceModule` exposes a request-scoped `TenantContext` (project id, actor, request id, trace id) and a `UnitOfWork`.
- `UnitOfWork.transaction(cb)` opens a Drizzle transaction. It used to bind the scope to the connection first — `select set_config('app.project_id', $1, true)`, parameterized because `SET LOCAL` takes no bind parameter, transaction-local so a pooled connection could not leak context into the next checkout — and there were two methods because there were two keys. With no policies to match against, there is nothing to bind and one method.
- `BaseRepository<TEntity, TId>` is abstract. It takes the transaction-bound Drizzle handle and the `TenantContext` in its constructor and owns query timing metrics, error translation (unique violation to `ConflictError`), and the `project_id` predicate. Concrete repositories (`UserRepository`, `SessionRepository`, `RefreshTokenRepository`) write only their queries.
- A repository **cannot be instantiated without a `TenantContext`**, so the tenant filter is structural rather than a convention someone might forget. **It is now the only line.** RLS was the second and §7.4's negative tests proved it; both are gone, and what replaces them is a repository-level isolation test against a real database with two tenants in it. `TenantContext` and `OrgContext` stay separate for the reason that matters more without RLS than with it: one context carrying both keys would let a repository filter on whichever it reached for.
- Transactions are explicit through `UnitOfWork.run(cb)`, and nested calls join the ambient transaction. The **outbox** (events, webhooks, audit) is written in the same transaction as the state change and then relayed to Pub/Sub, so we never emit an event for a rolled-back write.
- Migrations are numbered SQL files applied by a dedicated Cloud Run job before traffic shifts. Forward-only, with explicit expand and contract discipline for column changes.

### 9.5 Domain class families (what inherits from what)

| Abstract base (in `domain`) | Concrete implementations |
|---|---|
| `OAuthProvider` to `OidcProvider` | Google, Apple, Microsoft, GitHub, GitLab, Discord, Slack, LINE, Kakao and about 20 more |
| `EmailProvider` | SesEmailProvider (primary), Resend, Postmark, SendGrid, Mailgun, GenericSmtp |
| `SmsProvider` | Twilio, AwsEndUserMessaging, Vonage, Msg91, WhatsAppCloud, regional adapters |
| `MfaFactor` | TotpFactor, PasskeyFactor, SmsFactor, RecoveryCodeFactor |
| `TokenIssuer` | KmsEs256Issuer, LegacyHs256Issuer (migration-only, time-boxed) |
| `PasswordHasher` | Argon2idHasher, plus `BcryptHasher` and `ScryptHasher` used **verify-only** for imported hashes, transparently upgrading on next login |
| `RateLimitStrategy` | FixedWindow, SlidingWindow, TokenBucket, AdaptiveBackoff, and `PostgresFallbackStrategy` for a Valkey outage |
| `MigrationImporter` | FirebaseImporter, SupabaseImporter, Auth0Importer, ClerkImporter, CognitoImporter |
| `NotificationTemplate` | EmailTemplate, SmsTemplate (shared locale fallback and sandboxed binding in the base) |
| `DataSubjectRequestHandler` | AccessHandler, ErasureHandler, PortabilityHandler, RectificationHandler (§4.13.6) |
| `AuthFlow` | PasswordFlow, EmailOtpFlow, SmsOtpFlow, MagicLinkFlow, PasskeyFlow, OAuthFlow, AnonymousFlow, IdTokenExchangeFlow. The base owns hook invocation, audit, session creation and event emission ordering. |

`AuthFlow` is the most important of these: every way a user can sign in ends in the same inherited path, so MFA gating, session creation, `amr` claim assembly and event emission are written once. That path has two endings and not one: `authenticate` returns the session it issued, or the second factor the subject still owes, which is a discriminated union rather than an error because a first factor that verified is not a failure (ADR-0010).

### 9.6 Node-specific operational rules

- **Never block the event loop.** Argon2 hashing, key wrapping, MJML compilation and bulk import parsing run on a bounded `worker_threads` pool exposed as an injectable `WorkerPool` class. A synchronous crypto call on the request path is a review rejection.
- Event-loop lag, GC pause and heap usage are exported as metrics with SLOs (§6.3). Cloud Run concurrency is tuned against measured lag, not guessed.
- Explicit graceful shutdown: `SIGTERM` stops accepting, drains in-flight requests, flushes the outbox relay and OTel, then closes the pool. A Cloud Run revision must not drop a token refresh mid-rotation.
- Timeouts and `AbortSignal` on every outbound call (KMS, providers, hooks, HIBP). No unbounded `fetch`. Customer hooks are fail-closed with a hard deadline.
- `unhandledRejection` and `uncaughtException` are fatal: log, flush, exit non-zero, and let Cloud Run replace the instance. A process in an unknown state does not keep serving auth traffic.
- Memory ceilings set explicitly (`--max-old-space-size`) below the container limit, so we get a clean OOM rather than a hung instance.

---
## 10. Front-End Architecture (Nuxt, three panels)

**None of what follows is authentication UI.** These are our own three surfaces: a marketing site and two internal consoles. A customer's end user never sees any of them. §1.1 is the governing rule, and this section exists only because we do have front-end code of our own to organize.

### 10.1 The split

Three separate Nuxt applications, one shared component library (`@idenzy/ui`), one shared API client generated from `@idenzy/protocol`.

| Panel | App | Rendering | Audience | Hosting |
|---|---|---|---|---|
| **Landing** | `apps/landing` | **SSR on** (`ssr: true`) | Anonymous public: marketing, pricing, docs shell, blog, changelog | Cloud Run, behind Cloud CDN |
| **Client** | `apps/client` | **SSR off** (`ssr: false`, SPA) | Authenticated customers: the dashboard of §3.2 | Static bundle on GCS + Cloud CDN |
| **Admin** | `apps/admin` | **SSR off** (`ssr: false`, SPA) | Internal operators only | Static bundle, IAP/VPN-gated origin |

### 10.2 Why this split

- **Landing needs SSR** because it is indexed, shared, and judged on first paint. Server rendering is the only way to get correct meta and OG tags per route and a fast LCP on marketing traffic.
- **Client and admin must not have SSR.** They sit behind authentication, are invisible to crawlers and SEO-irrelevant, so SSR would buy nothing while adding a server that holds customer session material: real attack surface for zero benefit. As static SPAs they cost nothing to serve, deploy by uploading files, roll back instantly, and cannot leak one tenant's data into another's rendered HTML, because no rendering happens on our servers at all.
- Splitting client from admin is a **blast-radius decision**. Operator tooling (impersonation, spend caps, tenant suspension) is the highest-privilege code we write, and it never ships in the same bundle a customer downloads. It is also a separation-of-duties control (§4.13.7).

### 10.3 Shared conventions

- Nuxt (latest) with `<script setup lang="ts">`, TypeScript strict, Pinia for state, file-based routing, Vitest and Playwright.
- **Class-based where classes belong.** Vue components are SFCs, that is the framework's unit and we do not fight it. But everything behind the component layer is a class: API clients, Pinia store logic delegated to injectable service classes, form models, permission policies, error mapping. `@idenzy/ui` exposes an abstract `ApiClient` with `AuthApiClient` and `ManagementApiClient` subclasses, and an `ErrorPresenter` hierarchy that maps `@idenzy/protocol` error codes to localized messages. The rule from §7.2 applies to all non-SFC code in the panels.
- Auth for `client` and `admin` uses our own product (dogfooding), through the same headless SDK a customer would use: first-party HttpOnly cookies on the panel's domain, access token in memory, silent refresh, exactly the model we sell (§4.3). We build our own sign-in screens with `@idenzy/nuxt`, which is the most honest possible test of the headless claim. If that is painful for us, it is painful for customers, and we fix the SDK rather than papering over it with a component.
- Staff accounts on `admin` require MFA and are additionally IP/IAP-gated.
- `landing` calls no authenticated API. If a page needs user state it links to `client`, and the two never share a bundle or a token.
- Shared design tokens and an accessibility baseline (WCAG 2.2 AA, audited) live in `@idenzy/ui`.
- CSP is strict on every panel. No third-party scripts on `client` or `admin`. Analytics on `landing` only, self-hosted or cookieless.

### 10.4 Build and deploy

- `client` and `admin`: SPA build to immutable hashed assets on GCS, served by CDN with a short-TTL `index.html` and long-TTL assets. Runtime config is injected at build time per environment, and no secrets reach the bundle (publishable keys only).
- `landing`: Nuxt Nitro server on Cloud Run with route-rules-driven ISR/CDN caching, so most requests are served from the edge and SSR cost stays flat as traffic grows (§5.2 lever 5).
- Preview deployments per PR on `*.idenzy.io`, which is also the domain allowlisted for instant-mode OAuth (§4.6).

---

## 11. Email & SMS Subsystem

Email and SMS are content we send on the customer's behalf. They are not a web UI, and §1.1 does not touch them. This subsystem stays exactly as scoped, and it matters more in a headless product, not less: it is the one surface where we still speak directly to the end user, so its quality and deliverability are the customer's brand, not ours.

### 11.1 Provider abstraction

The ports live in `@idenzy/domain` as abstract classes; the adapters live in `@idenzy/providers-email` and `@idenzy/providers-sms` and extend them (§8.3). The base owns everything that must never be skipped (spend caps, suppression-list checks, rate ceilings, cost accounting, audit) and leaves only the transport to the subclass.

```ts
/** Port for outbound email. Subclasses supply transport only; the base owns the guarantees. */
export abstract class EmailProvider {
  protected constructor(
    protected readonly suppression: SuppressionList,
    protected readonly meter: UsageMeter,
    protected readonly clock: Clock,
  ) {}

  abstract readonly id: EmailProviderId;
  protected abstract dispatch(msg: OutboundEmail): Promise<ProviderMessageId>;
  abstract createSendingDomain(domain: DomainName): Promise<DnsRecords>;
  abstract verifyDomain(domain: DomainName): Promise<DomainStatus>;

  /** Template method: inherited guarantees, per-provider transport. */
  async send(ctx: TenantContext, msg: OutboundEmail): Promise<ProviderMessageId> {
    await this.suppression.assertSendable(ctx, msg.to);
    await this.meter.assertWithinQuota(ctx, Channel.Email);
    const id = await this.dispatch(msg);
    await this.meter.record(ctx, Channel.Email, { provider: this.id, messageId: id });
    return id;
  }
}

/** Port for outbound SMS. The base spends money only after fraud and cap checks pass. */
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

Implementations: **SES** (primary), Resend, Postmark, SendGrid and Mailgun (secondary and BYO), generic SMTP (BYO), plus **Twilio Programmable SMS**, **AWS End User Messaging**, Vonage, MSG91 (India), regional providers (Turkey and MENA, where Twilio is expensive) and the **WhatsApp Cloud API**. A `ProviderRouter` class holds the per-country routing table, picks the cheapest provider with acceptable deliverability, and fails over automatically on provider error rates. Every provider must pass the shared `EmailProviderConformanceSuite` or `SmsProviderConformanceSuite` before it can be registered (§7.4).

We generate OTPs ourselves rather than using Twilio Verify ($0.05 per verification on top of SMS): raw SMS is 3 to 5 times cheaper and we keep full control over templates, retry and fraud logic.

### 11.2 AWS SES setup (concrete)

1. Production access requested for a dedicated AWS account (out of sandbox), regions `eu-west-1` and `us-east-1` for redundancy.
2. Shared sending domain `mail.idenzy.io` (free tier) with SPF, DKIM (Easy DKIM 2048), DMARC `p=reject`, and a custom MAIL FROM domain (`bounce.mail.idenzy.io`) for bounce alignment. A subdomain rather than the apex, because sending reputation is per-domain and a deliverability incident must not reach mail from `idenzy.io` itself. `p=reject` is the end state and not the starting one: it is published only once a real message has shown `dkim=pass header.d=mail.idenzy.io` and `spf=pass`, since a misalignment under `p=reject` sends every one-time code silently to nowhere, on the flow §4.7 makes the default way in.
3. **Customer custom domains**: the dashboard calls `CreateEmailIdentity`, shows 3 DKIM CNAMEs plus MAIL FROM MX/TXT, and we poll `GetEmailIdentity` until verified. Each customer domain is a separate SES identity under our account, or in the customer's own AWS if BYO.
4. **Configuration sets** per plan tier with event publishing (send, delivery, bounce, complaint, reject) to SNS, into an HTTPS webhook on our `email-events` worker, into the suppression list. Hard bounces and complaints are never re-sent and surface in the dashboard as `email.bounced` webhooks.
5. Dedicated IPs only above roughly 500K/day. Before that, shared IP pools with SES reputation monitoring, and Virtual Deliverability Manager once volume justifies it.
6. Rate limiting per project protects our reputation. New projects start with a low daily ceiling that grows with a clean bounce rate.

### 11.3 Template engine and studio

- Template types: `email_verification`, `magic_link`, `email_otp`, `password_reset`, `email_change_old`, `email_change_new`, `invite`, `new_device_signin`, `mfa_enrolled`, `password_changed`, plus custom.
- Authoring: **MJML** (responsive, compiled to bulletproof HTML) with Handlebars-style variables (`{{user.email}}`, `{{otp}}`, `{{link}}`, `{{project.name}}`, `{{expires_in}}`) and a strict sandbox: no arbitrary code, output HTML-escaped, and `link` values signed and pinned to registered redirect targets to prevent open redirect via a template. MJML compilation is CPU-bound and runs on the worker pool, never inline on the request path (§9.6); compiled output is cached by template version.
- Studio features: visual editor plus raw MJML/HTML mode, live preview with sample data, test send, per-locale variants with a fallback chain (`tr-TR` to `tr` to `en`), plain-text auto-generation, brand kit (logo, colours, fonts), versioning with rollback, subject line and from-name per template, reply-to, custom headers, attachments disabled for security. Shipped inside the `client` panel (§10).
- Defaults: a clean, accessible set of templates in 30+ languages ships with every project, so customers start with zero configuration.
- "Send-email hook": customers can intercept and send through their own system (Supabase-style), and we then charge nothing.

### 11.4 SMS templates

Short template per event and per locale with `{{otp}}`, `{{project.name}}` and `{{expires_in}}`; a length guard for GSM-7 versus UCS-2 segments (this is a cost issue); an optional Android SMS Retriever hash appended for auto-fill; and alphanumeric sender ID registration per country handled in the dashboard, including the regulatory forms for India DLT, Turkey IYS-style rules, and US 10DLC/toll-free.

---

## 12. Data Model (core tables, Postgres)

**The Drizzle schema in `packages/persistence/src/schema/` is the source of truth.** `drizzle-kit` generates SQL migrations from it, we review and commit those, and a job applies them forward-only (§9.4). The listing below is the shape, not the definition. Entity classes in `@idenzy/domain` map onto it explicitly through repositories.

Every column is declared through the `classified()` wrapper of §4.13.2, which is what generates the RoPA, the data map, the log allowlist and the data-subject field lists.

```
orgs(id, name, billing_customer_id, created_at)
org_members(id, org_id, user_id, role[owner|admin|developer|viewer], invited_by, last_active_at)
org_invitations(id, org_id, email, role, token_hash, invited_by, expires_at, accepted_at, revoked_at)
org_security_settings(org_id, require_mfa, updated_by, updated_at)
projects(id, org_id, name, plan, compliance_tier, settings jsonb,
         kms_key_name, dek_wrapped bytea, created_at)
project_domains(project_id, domain, type[auth|email], status, dns_records jsonb)
redirect_uris(project_id, uri, kind[oauth|magic_link|post_signout], created_at)  -- exact-match allowlist
users(id, project_id, email, email_verified, phone, phone_verified, password_hash, password_algo_version,
      display_name, avatar_url, metadata_public jsonb, metadata_private jsonb, banned_until,
      last_sign_in_at, created_at, updated_at, deleted_at)
identities(id, user_id, project_id, provider, provider_user_id, email, provider_data jsonb,
           encrypted_tokens bytea, created_at)      -- unique(project_id, provider, provider_user_id)
sessions(id, user_id, project_id, device_id, ip, user_agent, amr[], factor_verified_at, created_at,
         last_active_at, idle_expires_at, absolute_expires_at, revoked_at, revoke_reason)
refresh_tokens(id, session_id, family_id, token_hash, parent_id, used_at, revoked_at, expires_at, device_key_id)
mfa_factors(id, user_id, type[totp|passkey|sms|recovery], secret_encrypted, credential jsonb,
            verified_at, last_used_at)
webauthn_credentials(id, user_id, credential_id, public_key, sign_count, transports[], aaguid,
                     backup_eligible, name)
otp_challenges(id, project_id, channel, target_hash, code_hash, flow_id, attempts, expires_at, consumed_at)
magic_link_tokens(id, project_id, token_hash, user_id, redirect_uri, expires_at, consumed_at)
oauth_flows(id, project_id, provider, code_verifier_hash, state, nonce, redirect_uri, expires_at)
oauth_providers(project_id, provider, client_id, client_secret_encrypted, scopes[], enabled,
                mode[instant|custom])
email_templates(project_id, type, locale, subject, mjml, html, text, version, updated_by)
webhooks(id, project_id, url, secret_hash, events[], enabled) / webhook_deliveries(...)
api_keys(id, project_id, kind[publishable|secret], prefix, hash, scopes[], last_used_at, revoked_at)
usage_daily(project_id, day, mau_hll, emails_sent, sms_sent, sms_cost)   -- HyperLogLog sketch for MAU
outbox(id, project_id, topic, payload jsonb, created_at, published_at, attempts)  -- transactional relay

-- Billing, keyed on org_id rather than project_id (ADR-0011). Money is integer cents.
payment_methods(id, org_id, provider, provider_method_id, brand, last4, expiry_month, expiry_year,
                is_default, added_by)                      -- one default per org, partial unique
credit_grants(id, org_id, kind[purchased|promotional], amount_cents, remaining_cents, currency,
              top_up_id, note, granted_at, expires_at)     -- the wallet; balance is a sum over these
billing_settings(org_id, currency, auto_top_up_*, spend_alert_*, updated_by, updated_at)
top_ups(id, org_id, amount_cents, state, trigger, provider, provider_intent_id, payment_method_id,
        card_brand, card_last4, failure_code, settled_at)  -- unique intent id: webhooks replay
invoices(id, org_id, number, period_start, period_end, status, total_cents, provider_invoice_id,
         pdf_uri, issued_at, due_at, paid_at, voided_at)   -- voided, never deleted
invoice_lines(id, org_id, invoice_id, project_id, item, quantity, unit_rate_millicents, total_cents)
payment_provider_events(id, provider, provider_event_id, type, payload jsonb, processed_at)
                                                           -- no org known on arrival

-- Compliance surface (4.13)
audit_events(id, project_id, actor_type, actor_id, action, target, ip, ua, metadata jsonb,
             prev_hash, entry_hash, created_at)      -- partitioned by month, INSERT/SELECT only
data_subject_requests(id, project_id, subject_user_id, kind[access|erasure|portability|rectification],
                      status, requested_at, due_at, completed_at, artifact_uri, requested_by)
retention_policies(project_id, subject, max_age, action[purge|tombstone|drop_partition])
staff_access_grants(id, staff_id, scope, granted_by, reason, created_at, expires_at, revoked_at)
```

All tenant tables carry `project_id` and every query against them goes through `BaseRepository`, which cannot be constructed without a `TenantContext` and filters on it. Org-scoped tables carry `org_id` and go through `OrgRepository` the same way (ADR-0011). `orgs` is keyed on its own `id`, the way `projects` is.

Both used to carry an RLS policy underneath, keyed on `current_setting('app.project_id')` or `app.org_id`, with `FORCE ROW LEVEL SECURITY` so that ownership was not an escape hatch. Those were removed (§4.10); the discriminator columns and the two repository bases are what remain. Two tables are scoped to nothing and say so in their own migration: `staff_access_grants` is about our staff rather than a customer, and `payment_provider_events` receives a webhook before the organisation it concerns is known.

---

## 13. Developer Experience: the five-minute integration

The promise is not "paste a component". It is "your existing form signs people in".

```bash
npx idenzy init          # creates the project, writes .env with the publishable key,
                         # detects the framework and scaffolds working auth routes into YOUR repo
```

```tsx
// React or Next.js. Your markup, your design system, our protocol.
import { IdenzyProvider, useSignIn, useUser } from "@idenzy/next";

function SignInForm() {
  const { signIn, status, error } = useSignIn();
  const onSubmit = (e) => {
    e.preventDefault();
    signIn.withPassword({ email: e.target.email.value, password: e.target.password.value });
  };
  return <form onSubmit={onSubmit}>{/* your fields, your styles */}</form>;
}
```

```ts
// Nuxt: module plus one runtime config key.
export default defineNuxtConfig({
  modules: ["@idenzy/nuxt"],
  idenzy: { publishableKey: process.env.NUXT_PUBLIC_IDENZY_KEY },
});

// Then, in any component:
const { signIn } = useIdenzySignIn();
await signIn.withEmailOtp({ email });          // sends the code
await signIn.verifyOtp({ code });              // completes; session cookie is set
```

```dart
// Flutter
await Idenzy.init(publishableKey: 'pk_...');
final user = await Idenzy.signInWithOAuth(Provider.google);
```

- **OTP first**: `withEmailOtp` plus `verifyOtp` needs no redirect, no page and no deep link, which is why it is the default we document first (§4.7).
- **`idenzy init` scaffolds code into the customer's repository**, which they then own and restyle. That is deliberately the opposite of a component dependency: there is nothing to keep in sync with our release cadence, and nothing of ours in their render tree.
- **Dashboard wizard** per OAuth provider: exact steps, redirect URI pre-filled and copyable, and a live "Test connection" button.
- Local dev: `localhost` allowed on dev keys, **instant OAuth** via shared apps, and email/SMS "log to console" mode with an inbox viewer in the dashboard, so no real sends happen in dev.
- Documentation: per-platform quickstarts, a "Security model explained" page, migration guides, an OpenAPI reference, a Postman collection, and an MCP server so AI coding tools integrate our SDKs correctly. Docs are served by the `landing` panel (SSR, because they need to be indexed).
- Error codes are stable, documented and machine-readable, which matters much more for us than for a vendor that ships UI: the customer's error messages are built from them (§7.2.8).
- CLI: `idenzy users import`, `idenzy templates pull/push`, `idenzy keys rotate`.

**Internal DX** (our own team): `pnpm i && pnpm run prepare && pnpm dev` boots Postgres and Valkey in containers, runs migrations, and starts `api`, the workers and all Nuxt panels through Turbo with hot reload. One command, no per-service setup. `pnpm gen:openapi` regenerates the spec and the non-TS SDK clients from `@idenzy/protocol`; `pnpm compliance:generate` regenerates the data map and RoPA from the schema.

---

## 14. Delivery Plan

| Phase | Duration | Scope |
|---|---|---|
| **0 - Foundations** | 5 weeks | pnpm workspace, Turbo, strict TS baseline, Biome with the §7 rules as real lint errors, husky/lint-staged/commitlint; Terraform for one deployment; NestJS/Fastify skeleton on Cloud Run; Drizzle schema with roles, grants and the migration runner; `TenantContext`/`UnitOfWork`/`BaseRepository`; the §4.13 compliance surface (classification wrapper, generators, audit hash chain, DSR and retention tables); KMS signing; JWKS and OIDC discovery; `IdenzyError` hierarchy and the error contract in `@idenzy/protocol`; Nuxt scaffolds for `landing` (SSR), `client` and `admin` (SPA); CI with Binary Authorization, provenance and the dependency policy. |
| **1 - MVP (private beta)** | 8 weeks | Email plus password, email OTP and magic link (SES), Google/Apple/GitHub/Microsoft OAuth (instant and custom), passkeys, sessions and refresh rotation, JS core plus React, Next and Nuxt SDKs, Node server SDK, framework starter templates and `idenzy init`, template studio v1, webhooks, usage metering, Cloud Armor rules, `client` panel v1. |
| **2 - Public launch** | 8 weeks | SMS and WhatsApp OTP with fraud controls, TOTP MFA and recovery codes, Vue/SvelteKit/Flutter/iOS/Android/React Native SDKs, custom auth domains, custom email domains, migration importers, billing (Stripe), `admin` panel v1, status page, SOC 2 readiness assessment against the §4.13 architecture. |
| **3 - Breadth** | 12 weeks | Angular, Solid, Astro, Unity, Godot and KMP SDKs; Python/PHP/Ruby/Java/.NET server SDKs; app attestation; device-bound tokens; security center; hooks. |
| **4 - B2B** | 12 weeks | Organizations, roles and permissions, invitations, SAML/OIDC SSO, SCIM, dashboard SSO, audit log export, enterprise SLA, and the compliance programme itself (§4.13.10) if enterprise demand justifies it. |

Team for phases 0 to 2: 2 backend (TypeScript/NestJS, one with a security background), 1 frontend (the three panels), 1 to 2 SDK engineers (mobile and web), 1 DevOps/SRE (part-time), plus an external pen test before public launch. The single-language stack means the frontend engineer can review protocol changes and the SDK engineers share the backend's types, and that overlap is what makes this headcount realistic.

Note what is *not* in this plan compared to a UI-shipping competitor: no component library, no theming API, no design system for auth screens, no accessibility audit across twenty components in thirty languages. That is roughly a full engineer-year per phase, and it is the budget that pays for the SDK breadth in phase 3.

Phase 0 is deliberately front-loaded. The class hierarchies, boundary lint rules, compliance generators and conformance-suite harness are built once, before any auth flow ships. Every phase after it is faster, because a new provider, factor or channel becomes a subclass and a test run.

---

## 15. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| A security incident kills trust (existential for an auth vendor) | Strict SDLC, external pen test before launch, bug bounty, small blast radius (per-project keys), rehearsed IR plan, transparent disclosure policy. RLS was part of this answer and is not any more (§4.10). |
| **Headless raises time-to-first-login versus Clerk** | This is the real cost of §1.1 and we accept it. Mitigated by `idenzy init` scaffolding working routes into the customer's repo, per-framework starter templates and quickstarts, an MCP server so AI coding tools write the integration correctly, and hard measurement: time-from-signup-to-first-successful-auth is a tracked product metric with a target under 15 minutes. If that number does not come down, the answer is better scaffolding and docs, not shipping a component. |
| Losing deals to "but Clerk has a drop-in component" | Qualify early. Our buyer is a team that already has a design system and wants control, and a price 8 times lower. Publish an honest comparison page rather than pretending the gap does not exist. |
| **npm supply-chain compromise** (large transitive dependency surface) | Dependency budget with sign-off, `ignoreScripts` plus an `onlyBuiltDependencies` allowlist, frozen lockfile, integrity pinning on the crypto path, nightly advisory scans, SBOMs, CI-only publishing with provenance (§7.6). Drizzle's zero runtime dependencies help here. |
| **Event-loop stall degrades the whole instance** | Worker pool for all CPU-bound work, event-loop lag as an alerting SLO (§6.3), load tests that specifically exercise Argon2 concurrency, `--max-old-space-size` below the container limit. |
| **Node memory and CPU cost erode margin** | Cost model already uplifted (§5.2), Fastify plus high concurrency plus bundled cold starts, quarterly cost-per-MAU review with a hard tripwire at $0.0008 marginal. |
| **Drizzle abstracts away something that matters** (partitions, index use) | Repositories own their SQL and it is reviewed as SQL. Generated migrations are read before they are committed. Partitioning is explicitly hand-authored (§9.4). A query-builder mistake **can** now become a tenancy breach, because the database no longer refuses one — which is the cost recorded in §4.10. ADR-0001 records the trigger for reversing this decision. |
| **Class-based architecture ossifies into over-abstraction** | Hierarchies stay shallow (base to concrete), an abstraction requires two real implementations before it is introduced, conformance suites keep bases honest, and there is an architecture review at each phase boundary. |
| **Compliance architecture is mistaken for compliance** | §4.13.10 states plainly what is not done. No sales material may claim a certification we do not hold, and the trust page says "architecture ready, uncertified" until an audit says otherwise. |
| **Data classification decays** | The `classified()` wrapper is the only way to declare a column, the schema lint rejects bare columns, and CI regenerates the RoPA and data map and fails on a diff. Decay is a build failure, not a discovery. |
| SMS pumping fraud burns margin | Attestation or CAPTCHA before send, country allowlists, spend caps, anomaly throttles, WhatsApp-first in expensive regions. |
| Free-tier abuse | Project verification, quotas, MAU anomaly detection, Cloud Armor. |
| Email deliverability and reputation on shared domains | Per-project warm-up ceilings, suppression lists, DMARC reject, provider failover, dedicated IPs at volume. |
| Provider dependency (SES, Twilio, Meta) | Abstraction layer plus at least two live providers per channel. |
| Price war (Firebase or Supabase drop prices) | Our differentiators are security defaults, managed delivery and platform breadth, not only price. Residency was on this list and is not offered (§4.13.5). The cost structure supports going lower. |
| SDK sprawl (20+ platforms) | One spec, a generated core, a conformance suite every SDK must pass, community contributions for Tier 2. Headless SDKs are far smaller than SDKs with UI, which is what makes the matrix survivable. |
| Monorepo build times grow with package count | Turbo remote caching, affected-only pipelines, per-package typecheck. Build time is tracked as a team metric with a 10-minute CI budget. |
| Cloud Run and Cloud SQL scaling ceilings | Read replicas, table partitioning (audit, sessions), an AlloyDB migration path. |

---

## 16. Open Decisions

Resolved since the first draft:

- ~~Product name and domains~~ **Resolved: "Idenzy", and everything is on `idenzy.io`.** Both domains are registered; `idenzy.dev` redirects to `idenzy.io` and is held defensively rather than used. The earlier draft split them — `.dev` for developer surfaces, `.io` for marketing and the dashboard — and that is what was rejected, for a reason the split had missed: `SameSite` is a *site* rule, so `app.idenzy.io` to `auth.idenzy.dev` is cross-site and the `__Host-` cookies of §4.3 never flow between them. Our own panel is the first cookie-mode deployment we have (ADR-0008), so a split would have had us dogfooding the header-mode fallback while selling the cookie model. One site keeps `app.idenzy.io` → `auth.idenzy.io` same-site. The cost is real and accepted: `.dev` is HSTS-preloaded and `.io` is not, so `idenzy.io` should be submitted to hstspreload.org to get the same guarantee. `idenzy.com` is still worth holding before any public announcement.
- ~~Query layer: hand-written SQL versus a typed query builder versus an ORM~~ **Resolved: Drizzle** (§9.4, ADR-0001).
- ~~Whether to ship hosted pages and embeddable components~~ **Resolved: no, and never** (§1.1, ADR-0002).
- ~~Lint and format toolchain~~ **Resolved: Biome**, with GritQL plugins for the project-specific bans, plus husky, lint-staged and commitlint (§7.5).
- ~~Launch region~~ **Resolved: `us-central1`.** The largest market and the cheapest region. This used to carry a second clause about `projects.cell_id` being immutable and a cell labelled EU that ran in Iowa making every residency claim false; there are no cells and no residency claim, so the region is now simply where the one deployment is (§4.13.5).

Still open, to resolve before Phase 0 ends:

1. Default access-token TTL: 5 min (proposed) versus 60 s (Clerk parity, higher cost).
2. Valkey from day one versus Postgres-only rate limiting for the first months.
3. Whether to open-source the auth server (a Supabase-style trust signal) while keeping the managed cloud as the business. Headless makes this easier, because there is no UI licensing question.
4. Billing granularity for email: per-send versus monthly bundles.
5. Panel hosting for `client` and `admin`: GCS plus CDN static (proposed) versus Firebase Hosting for simpler preview channels.
6. ~~Whether `management-api` stays a separate deployment~~ **Resolved: merged.** One service, `apps/api`, serving both surfaces on one port (2026-09-21). The separation was preferred here and the cost was about $25/mo; what decided it the other way was the operational weight of two of everything — two CORS policies, two connection pools, two bootstraps — for a product with no customers yet. The thing the split protected is written down so it can be taken back: a dashboard incident can now degrade sign-in, because they share a process.
7. Whether magic links ship in Phase 1 at all, or wait until Phase 2 given that OTP covers the same need without a redirect (§4.7).
8. Whether native SDKs (Swift, Kotlin, Dart) live in this repo or in separate repositories wired in as git submodules. SPM, Maven and pub.dev all expect a repository root, which argues for splitting them out at Phase 2.
9. Node version policy: pin to the active LTS line, or track Current for the performance work. Related: TypeScript 7 is released, but the NestJS toolchain still targets TypeScript 6, so we are pinned to 6.0.x until that lands.
10. **Whether we ever hold a user's age.** There is no date of birth, age band or minor flag anywhere in the schema. COPPA reaches under-13s and GDPR Art. 8 sets a digital consent age member states may place between 13 and 16, and an authentication provider is where age gating would have to live. Retrofitting it means a classified column with its own lawful basis, a verification flow, and a migration over live user rows — so this wants deciding before the first customer even if the answer is "never, and customers gate their own sign-up". See `docs/compliance/us-and-eu-readiness.md`.
11. **How EEA data reaches a US entity lawfully**: self-certify to the EU-US Data Privacy Framework, or Standard Contractual Clauses plus a transfer impact assessment with each customer. Not architectural — it decides what the subprocessor register and the DPA say, and the first is far cheaper to operate. Our subprocessors' own certifications do not cover us as importer.

---

## Appendix: reference numbers used (Sept 2026)

- Firebase / Identity Platform: 50K MAU free; $0.0055 / $0.0046 / $0.0032 / $0.0025 tiers; SAML/OIDC $0.015/MAU; SMS $0.01 to $0.46 by country.
- Supabase: 50K MAU free (Free), 100K (Pro $25/mo), then $0.00325/MAU; SSO $0.015/MAU; Advanced MFA $75/mo.
- Clerk: 50K MRU free since Feb 2026; Pro $25/mo plus $0.02/MRU; 60-second session JWTs refreshed by the SDK; client token cookie on a FAPI CNAME.
- AWS SES: $0.10 per 1,000 emails; dedicated IP $24.95/mo.
- Twilio Verify: about $0.05 per verification plus SMS cost; raw US SMS about $0.008 to $0.02 across providers; WhatsApp auth messages about $0.0014 to $0.0034.
