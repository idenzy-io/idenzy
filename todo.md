# Idenzy: delivery checklist

Task-level breakdown of the delivery plan in [PROJECT.md](./PROJECT.md) §14. Phase 0 is itemized to
commit-sized units. Later phases are itemized to task level and will be broken down further as they
are approached.

**Conventions**

- `[ ]` not started, `[~]` in progress, `[x]` done.
- Section references like §4.13 point at PROJECT.md.
- A task that changes an auth flow needs a threat-model note on the PR (§7.5).
- A task that adds or changes a database column needs a `classified()` declaration and a regenerated
  data map (§4.13.2), which CI checks.

---

## Phase 0: Foundations (5 weeks)

**Status.** The exit criteria below are met. What remains unchecked in this phase is
listed honestly rather than quietly closed: the KMS token issuer (only the local one
exists), JWKS caching and key rotation, the OpenTelemetry bootstrap, the Postgres
rate-limit fallback, the audit interceptor, Secret Manager loading, OpenAPI generation,
distroless images and Binary Authorization. None of them blocks Phase 1 starting.

**Exit criteria.** `pnpm turbo run typecheck lint build` is green across every package. Migrations
apply to a clean Postgres 17 and create the roles, grants and RLS policies. The RLS negative test
passes, meaning a deliberately misused repository still cannot read another tenant's rows. `auth-api`
boots and serves `/healthz`, JWKS and OIDC discovery. The compliance generators produce a data map
and RoPA from the schema, and CI fails if the committed copies are stale.

### 0.1 Repository and toolchain

- [x] `git init`, repo-local identity, `.gitignore`, `.nvmrc`, `.editorconfig`
- [x] Supply-chain settings in `pnpm-workspace.yaml`: `ignoreScripts`, isolated node-linker,
      frozen lockfile, exact saves (§7.6). Not `.npmrc`, which pnpm 11 ignores for these.
- [x] README stating the headless position and the compliance posture
- [x] pnpm workspace definition and root `package.json` scripts
- [x] `tsconfig.base.json` with the full strict set from §7.1, extended by every package
- [x] Turborepo task graph: `build`, `typecheck`, `lint`, `test`, `test:integration`, `bundle`
- [x] Biome config with the §7.5 rule table, and `overrides` transcribing the §8.3 layer boundaries
- [x] GritQL plugin `no-raw-throw` banning `throw new Error(...)` (§7.2.8)
- [x] GritQL plugin rejecting bare Drizzle columns that skip `classified()` (§4.13.2)
- [x] husky, lint-staged and commitlint; document that `ignoreScripts` means running
      `pnpm run prepare` once after clone
- [x] `docker-compose.yml` with Postgres 17 and Valkey
- [~] `pnpm dev` boots containers, migrates, and starts every app through Turbo. The apps
      now read `.env` through `--env-file-if-exists` and `.env.example` lists what they
      need; `pnpm bootstrap` still does the container and migration half separately

### 0.2 Architecture decision records

- [x] ADR-0001 Drizzle over hand-written SQL and over a runtime ORM, including the reversal trigger
- [x] ADR-0002 No authentication UI, ever
- [x] ADR-0003 Tenancy: RLS plus `set_config` plus a repository that cannot exist without a tenant
- [x] ADR-0004 Compliance by column classification, with generated artifacts
- [x] ADR-0005 Biome over ESLint and Prettier, and what we gave up

### 0.3 `@idenzy/protocol`

- [x] Error code enum, stable and documented, shared by server, SDKs and panels
- [x] Zod schemas for every wire type, with types inferred from them and never declared separately
- [x] Domain enums declared once (§7.1)
- [x] The public error contract shape returned by the exception filter
- [ ] OpenAPI generation from the schemas (`pnpm gen:openapi`)

### 0.4 `@idenzy/core`

- [x] `IdenzyError` base with `code`, HTTP status, safe public message, internal detail
- [x] Error subclasses: validation, auth, conflict, not-found, rate-limit, provider, internal
- [x] `Clock` port and a system implementation, so time is injectable everywhere
- [x] `Logger` port, implemented in `@idenzy/observability`
- [x] Value objects that cannot be constructed invalid: `EmailAddress`, `E164PhoneNumber`, `ProjectId`
- [x] `Result` type for expected failures that are not exceptional

### 0.5 `@idenzy/config`

- [x] Schema-validated config classes, parsed once at boot, failing fast on a bad environment
- [ ] Secret Manager loader with a local `.env` fallback for development
- [x] The only place in the codebase that reads `process.env`, enforced by `style/noProcessEnv`

### 0.6 `@idenzy/persistence`

- [x] Drizzle schema for the §12 core tables
- [x] Drizzle schema for the §12 compliance tables
- [x] RLS policies declared in the schema, keyed on `current_setting('app.project_id')`
- [x] Custom migration creating `idenzy_owner` and `idenzy_app`, with `NOBYPASSRLS` on the app role
- [x] Custom migration applying `FORCE ROW LEVEL SECURITY` to every tenant table
- [x] Custom migration granting `INSERT` and `SELECT` only on `audit_events` (§4.13.3)
- [x] Custom migration creating monthly partitions for `audit_events` and the partition maintenance job
- [x] `TenantContext`: project id, actor, request id, trace id, request-scoped
- [x] `UnitOfWork.run(cb)` opening a transaction and setting `app.project_id` via parameterized
      `set_config`, transaction-local
- [x] Abstract `BaseRepository` owning the tenant predicate, query timing and error translation
- [x] Migration runner as a standalone job, forward-only
- [x] `pnpm db:generate`, `db:migrate`, `db:studio` scripts

### 0.7 `@idenzy/compliance`

- [x] `classified()` column wrapper carrying class, purpose, retention, subject and erasure behaviour
- [x] `encrypted()` column wrapper delegating to `FieldEncryptor`
- [x] Data map generator writing `docs/compliance/data-map.md`
- [x] RoPA generator writing `docs/compliance/ropa.md` (GDPR Art.30)
- [x] Log redaction allowlist generator consumed by `@idenzy/observability` (§4.13.8)
- [x] Data-subject field list generator consumed by the DSR handlers
- [x] Audit hash-chain helper: compute and verify `entry_hash`
- [x] `pnpm compliance:generate`, and a CI check that fails on a stale committed copy
- [x] `docs/compliance/controls.md` mapping frameworks to the artifacts that satisfy them
- [x] `docs/compliance/subprocessors.md`

### 0.8 `@idenzy/crypto`

- [x] Abstract `TokenIssuer`, with `KmsEs256Issuer` as the first implementation
- [ ] JWKS cache and the public JWKS document per project
- [ ] Key rotation with overlapping `kid` publication
- [x] Abstract `PasswordHasher`, with `Argon2idHasher` on a bounded worker pool
- [x] `WorkerPool` class, so no CPU-bound call ever runs on the event loop (§9.6)
- [x] `FieldEncryptor`: per-project DEK, KMS-wrapped, for §4.13.4
- [x] Token generators for refresh tokens, OTPs and single-use codes, all `crypto.randomBytes`

### 0.9 `@idenzy/cache`

- [x] Valkey client with timeouts and graceful degradation
- [x] Abstract `RateLimitStrategy`, with fixed window, sliding window and token bucket
- [ ] `PostgresFallbackStrategy` for a Valkey outage (§6.3)
- [x] Revocation set: write, query and the signed cacheable endpoint (§4.2)

### 0.10 `@idenzy/observability`

- [ ] OpenTelemetry bootstrap with auto-instrumentation for Fastify, pg and Valkey
- [x] Pino logger using the generated allowlist, dropping undeclared fields (§4.13.8)
- [x] Event-loop lag, GC pause and heap metrics exported with the §6.3 SLOs
- [ ] `RequestContext` carrying request id and trace id
- [ ] Audit interceptor writing to the outbox

### 0.11 `@idenzy/domain`

- [x] Entities with behaviour: `User`, `Session`, `RefreshTokenFamily`, `Project`
- [x] Abstract ports: `EmailProvider`, `SmsProvider`, `OAuthProvider`, `MfaFactor`, `AuthFlow`
- [x] Abstract `DataSubjectRequestHandler` (§4.13.6)
- [x] Zero imports from infrastructure, enforced by lint

### 0.12 Applications

- [x] `auth-api`: Nest bootstrap on the Fastify adapter, graceful shutdown, fatal error handling
- [x] `TenantResolutionGuard` resolving a project by Host or key
- [x] `ExceptionFilter` mapping `IdenzyError` to the protocol error contract
- [x] Assert no endpoint ever returns `text/html` (§4.3), with a test
- [x] `/healthz` and `/readyz`
- [x] `/.well-known/jwks.json` and `/.well-known/openid-configuration`
- [x] `management-api` skeleton with the same pipeline
- [x] `workers` standalone skeleton with one module per consumer
- [x] `landing` Nuxt scaffold, SSR on
- [x] `client` Nuxt scaffold, SPA
- [x] `admin` Nuxt scaffold, SPA

### 0.13 `@idenzy/testing`

- [x] Testcontainers harness bringing up Postgres and Valkey
- [x] Fakes for `Clock`, `Logger`, KMS and providers
- [x] Abstract conformance suite base class (§7.4)
- [x] RLS negative test: a misused repository still reads zero cross-tenant rows
- [x] Audit immutability test: `UPDATE` and `DELETE` rejected for `idenzy_app`
- [x] Audit hash-chain verification test

### 0.14 CI and infrastructure

- [x] CI pipeline: install, typecheck, lint, unit, build, integration, image, sign
- [x] Frozen lockfile enforcement and the dependency advisory scan
- [x] Compliance artifact regeneration and staleness check
- [x] CycloneDX SBOM per release
- [x] Terraform skeleton for one region cell: Cloud Run, Cloud SQL, Valkey, KMS, LB, Armor
- [ ] Distroless, non-root, read-only-filesystem runtime images
- [ ] Binary Authorization and provenance
- [x] `CLAUDE.md` recording repository conventions

---

## Phase 1: MVP, private beta (8 weeks)

**Exit criteria.** A developer can sign up, create a project, install `@idenzy/next`, and have working
email-password and Google sign-in in their own UI in under 15 minutes, measured.

**Status.** 1.1 is done, and 1.2 is done but for the long tail of providers. Social
sign-in works end to end for Google, Apple, GitHub and Microsoft, and account linking is
closed along with it.

Passkeys (1.3) are done on both sides now. Both ceremonies verify, credentials carry
their sign counter and both backup flags, and the sign-in is usernameless because
registration demands a resident key. Conditional UI landed with the SDK: it is one option
on the sign-in call, and it works only because the options endpoint names no credential.
What is left is passkeys as a second factor, which is phase 2 with the rest of MFA.

Delivery (1.4) is built as far as it can go without a third-party sender: the
`EmailProvider` base, its conformance suite, the suppression list, the usage counter, the
template binding sandbox with its locale fallback, and the English default templates. The
only transport is `LoggingEmailProvider`, which prints the message and refuses to
construct outside development, so the first real adapter is a change to `DeliveryModule`
and nothing else.

Two things now block a deploy rather than one. `TokenIssuer` already refused to start
outside development without KMS, and `FieldEncryptor` now does the same: OTP targets,
magic-link targets, OAuth PKCE verifiers and provider client secrets are all envelope
encrypted, and the per-project data key is KMS-wrapped. Both are the same piece of work.

The SDKs (1.5) are what the fifteen-minute exit criterion is actually measured against,
and `@idenzy/js` is the one they are all built on. It is done: the session and its single
renewal, single-flight refresh under a cross-tab lock, negotiated transport, every flow
that ends in a session, the passkey ceremonies, OAuth with PKCE, the session list and the
device name that keeps it from being a list of blanks. `@idenzy/react` is the first
framework binding on top of it, and it is a provider and three hooks with no UI in it.
`@idenzy/node` came before the framework packages rather than after, because a page
rendered on a server verifies a token rather than holding a session, and `@idenzy/next`
needs that half to exist.

The framework bindings are now in: React, Vue, Svelte, Angular, Next and Nuxt. They are
small because the part worth getting right lives in `SessionStore` in `@idenzy/js`, which
each of them wraps in whatever its framework calls external state. Angular came forward
from phase 3 for the same reason. What is left in 1.5 is the conformance suite that holds
them to the same behaviour, `idenzy init`, and the starter templates.

### 1.1 Core auth flows

- [x] Abstract `AuthFlow` with the inherited `issueSession()` path (§9.5). The base also
      owns MFA gating, which phase 2 turns from a throw into a challenge
- [x] `PasswordFlow`: Argon2id, HIBP k-anonymity check, timing-equalized failures. Split
      into `PasswordSignUpFlow` and `PasswordSignInFlow`, both `AuthFlow` subclasses
- [x] Sign-up, sign-in, sign-out, session listing, session revocation
- [x] Refresh token rotation with family-based reuse detection, and the attack test
- [x] `EmailOtpFlow`, the default passwordless path. Signs in and signs up, because the
      code proves the same thing either way; an address proved this way is stored verified
- [x] `MagicLinkFlow` redirecting to a registered customer URL with a single-use code (§4.7)
- [x] Password reset and email change, both requiring confirmation on old and new addresses.
      Email change has no step-up in front of it yet: §4.5 asks for a recent factor
      verification and that arrives with MFA in phase 2, so it takes a session and says so
- [x] `AnonymousFlow` with upgrade to a full account, keeping the user id
- [x] Account linking rules driven by `email_verified` (§4.6). Wired into the OAuth
      callback, with the test that matters: an unverified provider address matching an
      existing account links nothing and returns `linking_requires_verification`

### 1.2 OAuth

- [x] `OAuthProvider` base with the template method of §7.2, plus its conformance suite.
      The suite's strongest cases assert that no HTTP request happened at all: a forged
      state that still reached the token endpoint has already handed the provider an
      attacker-supplied code, and refusing afterwards does not undo it
- [x] `OidcProvider` intermediate, owning id_token verification and the mix-up defence
- [x] Google, Apple, GitHub and Microsoft
- [x] Flow store, PKCE, state binding, nonce, exact-match redirect allowlist. State is
      consumed in one statement so it is a one-shot token rather than a value that merely
      matches, and the allowlist is re-checked at the callback and not only at start
- [x] Instant dev mode restricted to localhost and `*.idenzy.dev`
- [x] Provider token storage with envelope encryption, opt-in only via `storeTokens`
- [ ] The provider tail from §4.6: Facebook, Discord, X, Twitch, LinkedIn and the rest.
      Each is an endpoint pair and a profile mapping now that the base exists
- [ ] Linking a provider to a signed-in account is `POST /link` returning JSON, because a
      browser navigation cannot carry an access token. It becomes a plain redirect once
      web cookie mode lands (1.6)

### 1.3 Passkeys

- [x] WebAuthn registration and authentication ceremonies. Options are ours, because they
      are a JSON literal around a nonce and generating them keeps the published shape and
      the sent shape the same. Verification is `@simplewebauthn/server` (§6.2), which is
      the CBOR and signature half. `PasskeyFlow` extends `AuthFlow` like every other way in
- [x] Credential storage, sign count, backup eligibility. BE and BS are separate columns
      because only one of them moves, and both come from signed authenticator data rather
      than from anything the browser reported
- [x] The relying party is per project and configured, never derived from the request Host.
      One RP ID per project, enforced by a unique index: a second one would split a
      customer's passkeys into two sets that cannot substitute for each other
- [x] Attack tests against a real software authenticator in `@idenzy/testing`: a replayed
      challenge, a counter that did not advance, an unregistered origin, a credential from
      another project, a forged user handle, and a registration challenge minted for
      someone else. A fake verifier would have accepted every one of them
- [x] Conditional UI support in the JS SDK. `signIn({ conditional: true })` asks the browser
      for `mediation: "conditional"`, which is only possible because the server half names no
      credential: authentication options take no identifier, so autofill has something
      discoverable to offer whoever is at the keyboard
- [ ] Passkey as a second factor and for step-up. Phase 2, with the rest of MFA: the
      ceremony is the same one, what changes is `AuthFlow` gating a challenge rather than
      throwing

### 1.4 Delivery

- [x] `EmailProvider` base and conformance suite. The suite tests inherited guarantees,
      not transport: suppressed and over-quota sends are refused and unmetered, a success
      is metered once, and suppression is reported ahead of quota
- [x] `LoggingEmailProvider`, the development transport. Prints the whole message and
      refuses to construct outside development, because the field allowlist cannot protect
      a log *message*
- [x] Suppression list and the daily usage counter, both enforced by the base class
- [ ] SES adapter, shared sending domain, SPF, DKIM, DMARC. Deliberately not started:
      nothing is deployed yet, and the base plus the conformance suite are what a new
      adapter has to satisfy either way
- [ ] Bounce and complaint webhook into the suppression list. The list and its repository
      exist and are enforced; the webhook needs a provider to receive one from
- [~] Template engine. The binding sandbox and the locale fallback chain are done, in
      `@idenzy/templating`. MJML compilation is not: it is CPU-bound work belonging on the
      worker pool with output cached by version (§9.6), and the built-in templates are
      authored as plain HTML because they sit on the request path of every OTP and never
      change at runtime. Customer-authored MJML compiles when the studio lands
- [~] Default templates in English are shipped. The wider locale set is not
- [ ] Template studio v1 inside the `client` panel

### 1.5 SDKs

- [x] `@idenzy/js` core: session state, token refresh, storage rules, stable error codes.
      Single-flight refresh via `navigator.locks` is a requirement rather than an
      optimisation, because the server stays strict about reuse (ADR-0007)
- [x] `signOut("all")` and the session list in the SDK, plus device naming at session
      creation. The name is the client's to give, on `X-Idenzy-Device-Name` and only on the
      request that creates a session; the server stores it and never derives one, because
      parsing a user agent rots and a wrong guess on a security screen is worse than a blank
- [x] `@idenzy/react` hooks: `IdenzyProvider` plus `useIdenzy`, `useSession` and `useUser`.
      The client is a prop and never built in a render, because two clients on one page
      rotate the same token and the second rotation revokes the family (ADR-0007). The
      session gains a third status, `loading`, which is what keeps an application from
      flashing its sign-in screen at someone who is already signed in
- [x] `@idenzy/next` with App Router support and middleware. The browser half is
      `@idenzy/react` re-exported; what Next adds is `IdenzyServer`, which verifies the
      session cookie in a Server Component, Route Handler or middleware with no network
      call, and `protectRoutes`, which redirects to a page in the customer's own app
- [x] `@idenzy/nuxt` module and composables. Given a project id the server verifies the
      cookie itself and seeds the payload, so the browser hydrates from the snapshot the
      HTML was rendered from. One client per request, never a module singleton
- [x] `@idenzy/vue` plugin and composables
- [x] `@idenzy/svelte` context and stores
- [x] `@idenzy/angular` provider and signals. Pulled forward from phase 3, because the
      shared session store made it an afternoon rather than a project
- [~] `@idenzy/node` server SDK. Access-token verification is done: remote JWKS with the
      cache and the one refetch a rotation needs, `aud` required because one issuer serves
      every project and the audience is the only thing separating tenants, and reading the
      token out of a request so SSR costs no round trip. Webhook verification and the
      management client wait on their server halves, which are 1.6 and not built yet
- [ ] SDK conformance suite that every client must pass
- [ ] `idenzy init` scaffolding working routes into the customer's repository
- [ ] Starter templates per framework, in `examples/`

### 1.6 Platform

- [x] PKCE on our own exchange codes, for OAuth and deliberately not magic links: a link is
      clicked in a different browser from the one that started it, so a verifier held by the
      starter would fail the normal case every time. Verified after the code is consumed, so a
      wrong verifier burns it
- [x] `X-Idenzy-Publishable-Key`, so a browser can name its project while `Authorization`
      carries the user's token. First-present-wins, and `pk_` only
- [x] Browser origins as their own exact-match allowlist (`project_origins`, ADR-0006), and
      cross-origin access with credentials. Enforced on the actual response; the preflight is
      strict only where `Host` names a project, because it cannot see the key header
- [x] Web first-party cookie mode: `__Host-idenzy-refresh` for the opaque credential and
      `__Host-idenzy-session` for the access token, so SSR verifies offline with no network
      call. CSRF double-submit, Origin and Fetch-Metadata checks, all applied by one
      interceptor and one guard rather than per route. Header mode stays the documented
      cross-site fallback
- [x] `GET /v1/users/me`, and `includeUser` on refresh, so an SDK boot is one round trip
- [x] Reuse telemetry on `security.refresh_token_reused`. Nothing branches on it (ADR-0007)
- [ ] Cookie mode is implemented but unusable in production until custom auth domains exist:
      `SameSite` is a site rule, so it needs the auth API to be same-site with the app
- [ ] Project creation, API keys, custom auth domain provisioning
- [ ] Webhooks with HMAC signing, retries and replay safety
- [ ] Usage metering and the MAU HyperLogLog sketch
- [ ] `client` panel v1: users, sessions, providers, templates, keys, usage
- [ ] Cloud Armor rules and application rate limits

---

## Phase 2: Public launch (8 weeks)

- [ ] SMS and WhatsApp OTP with the full fraud control set (§4.8)
- [ ] `SmsProvider` base, Twilio and AWS End User Messaging adapters, `ProviderRouter`
- [ ] Spend caps, country allowlists and pumping detection
- [ ] TOTP MFA, recovery codes, step-up authentication and the `fva` claim
- [ ] Customer-defined claim templates: a dashboard-configured mapping from user columns and
      `metadata_public`/`metadata_private` into the access token, applied by the token issuer.
      Costs nothing at issue time, because the project config is already cached and the user
      row is already loaded, unlike the synchronous `customize-claims` hook in phase 3. Four
      rules it must carry: reserved claims (`iss`, `sub`, `aud`, `exp`, `iat`, `nbf`, `jti`,
      `sid`, `amr`, `acr`, `fva`) cannot be targeted, and the denylist lives in
      `@idenzy/protocol` so the server and the dashboard cannot disagree; a claim marked
      required fails token issue rather than emitting the token without it; mapping from
      `metadata_private` is a publication and needs an explicit acknowledgement; and the total
      claim bytes are capped at template-save time, because tokens travel in a header
- [ ] Vue, SvelteKit, Flutter, iOS, Android and React Native SDKs
- [ ] Custom email domains with guided DKIM setup
- [ ] Migration importers: Firebase, Supabase, Auth0, Clerk, Cognito
- [ ] Billing on Stripe, metered against usage
- [ ] `admin` panel v1: tenancy administration, abuse response, spend caps
- [ ] Status page and public incident communication
- [ ] External penetration test
- [ ] SOC 2 readiness assessment against the §4.13 architecture
- [ ] Public comparison page, honest about the UI gap (§15)

---

## Phase 3: Breadth (12 weeks)

- [ ] Solid, Astro, Remix, Electron, Tauri and Capacitor SDKs. Angular landed in phase 1
- [ ] Unity and Godot SDKs
- [ ] Kotlin Multiplatform SDK
- [ ] Python (Both async and sync), PHP, Ruby, Java, .NET, Go and Rust server SDKs
- [ ] Second region cell and the residency routing rules (§4.13.5)
- [ ] App attestation: App Attest and Play Integrity
- [ ] Device-bound refresh tokens with proof-of-possession
- [ ] Security center: breached password alerts, impossible travel, attack dashboards
- [ ] Synchronous customer hooks with a fail-closed deadline

---

## Phase 4: B2B (12 weeks)

- [ ] Organizations, memberships, roles and permissions
- [ ] Invitations
- [ ] SAML and enterprise OIDC SSO
- [ ] SCIM provisioning
- [ ] SSO for our own dashboard
- [ ] Customer-facing audit log export
- [ ] Enterprise SLA and dedicated cells
- [ ] The compliance programme itself, if enterprise demand justifies it (§4.13.10)

---

## Cross-cutting tracks

### Security

- [ ] Threat-model review for every new auth flow, as a PR gate
- [ ] Attack tests, not only happy-path tests, on every security-critical path (§7.4)
- [ ] Annual third-party penetration test
- [ ] Public bug bounty and `security.txt`
- [ ] Incident response runbooks: key compromise, provider outage, data breach
- [ ] Quarterly restore drill, with the record kept as evidence

### Compliance

- [ ] Keep §4.13.10 accurate. Nothing in sales material may claim a certification we do not hold
- [ ] Evidence artifacts produced per release into `compliance/evidence/` (§4.13.9)
- [ ] Quarterly access review from `staff_access_grants`
- [ ] Audit hash-chain verifier running on a schedule
- [ ] DSR due-date alerting, so an overdue request pages someone
- [ ] Retention jobs actually enforcing `retention_policies`
- [ ] Subprocessor register kept current
- [ ] Revisit certification timing at the end of Phase 2

### SDK

- [ ] One conformance suite that every SDK runs, in every language
- [ ] Identical error codes across all SDKs, generated from `@idenzy/protocol`
- [ ] Platform storage rules audited per SDK: Keychain, Keystore, SecureStore, HttpOnly cookies
- [ ] npm provenance and CI-only publishing (§7.6)
- [ ] Measure time-from-signup-to-first-successful-auth, target under 15 minutes (§15)
- [ ] Consume the Valkey revocation set from `@idenzy/node` and the SSR helpers. Revocation is
      already immediate against our own API, because `SessionGuard` reads the session row. It
      is not immediate for anything verifying offline, which is the cost of zero-network-call
      SSR and the reason the default token TTL is short

### Docs

- [ ] Per-platform quickstarts
- [ ] "Security model explained"
- [ ] "Why we do not ship UI", the customer-facing version of §1.1
- [ ] Migration guides from each competitor
- [ ] OpenAPI reference and Postman collection
- [ ] MCP server so AI coding tools integrate the SDKs correctly

---

## Parked and deferred

- [ ] **The audit hash chain needs a total order before the outbox relay can build it.**
      Appending means linking to the project's current tip, and `audit_events` is ordered
      only by `created_at`, which ties at millisecond precision. Two entries in the same
      millisecond would fork the chain. The fix is a monotonic sequence column, which is a
      schema change to a partitioned append-only table, so it is done deliberately with
      the relay rather than in passing (§4.13.3).
- [ ] KMS token issuer, and the per-project data encryption key alongside it. `auth-api`
      refuses to boot outside development rather than sign with an ephemeral in-process
      key (§4.2), and `FieldEncryptor` now refuses on the same terms rather than encrypt
      OTP and magic-link targets under a key derived from the cell code (§4.13.4). One
      piece of work, two things blocking a deploy.
- [ ] Valkey revocation set is not wired into `SessionGuard`, which reads the session row
      instead. Affordable while every authenticated route queries anyway; not affordable
      once one does not (§4.2).
- [ ] TypeScript 7. Released, but `@nestjs/cli` 12 depends on `typescript@~6.0.2` and Nest DI needs
      `emitDecoratorMetadata`. Pinned to 6.0.x; revisit when the Nest toolchain moves.
- [ ] Node version policy: pin to the active LTS line, or track Current for the performance work
      (§16.10).
- [ ] Native SDK repositories (Swift, Kotlin, Dart) as git submodules. SPM, Maven and pub.dev expect
      a repository root, which argues for splitting them out at Phase 2 (§16.9).
- [ ] Table partitioning migrations are hand-authored, since `drizzle-kit` does not generate them
      (§9.4). Keep them in the numbered sequence and review them as SQL.
- [ ] Open decisions 1 to 10 in §16, to be closed before Phase 0 ends.
