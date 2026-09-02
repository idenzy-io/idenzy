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
- [ ] `pnpm dev` boots containers, migrates, and starts every app through Turbo

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

### 1.1 Core auth flows

- [ ] Abstract `AuthFlow` with the inherited `issueSession()` path (§9.5)
- [ ] `PasswordFlow`: Argon2id, HIBP k-anonymity check, timing-equalized failures
- [ ] Sign-up, sign-in, sign-out, session listing, session revocation
- [ ] Refresh token rotation with family-based reuse detection, and the attack test
- [ ] `EmailOtpFlow`, the default passwordless path
- [ ] `MagicLinkFlow` redirecting to a registered customer URL with a single-use code (§4.7)
- [ ] Password reset and email change, both requiring confirmation on old and new addresses
- [ ] `AnonymousFlow` with upgrade to a full account
- [ ] Account linking rules driven by `email_verified` (§4.6)

### 1.2 OAuth

- [ ] `OAuthProvider` base with the template method of §7.2, plus its conformance suite
- [ ] `OidcProvider` intermediate
- [ ] Google, Apple, GitHub and Microsoft
- [ ] Flow store, PKCE, state binding, nonce, exact-match redirect allowlist
- [ ] Instant dev mode restricted to localhost and `*.idenzy.dev`
- [ ] Provider token storage with envelope encryption, opt-in only

### 1.3 Passkeys

- [ ] WebAuthn registration and authentication ceremonies
- [ ] Credential storage, sign count, backup eligibility
- [ ] Conditional UI support in the JS SDK

### 1.4 Delivery

- [ ] `EmailProvider` base and conformance suite
- [ ] SES adapter, shared sending domain, SPF, DKIM, DMARC
- [ ] Bounce and complaint webhook into the suppression list
- [ ] MJML template engine with a sandboxed binding and locale fallback
- [ ] Default templates in English, then the wider locale set
- [ ] Template studio v1 inside the `client` panel

### 1.5 SDKs

- [ ] `@idenzy/js` core: session state, token refresh, storage rules, stable error codes
- [ ] `@idenzy/react` hooks
- [ ] `@idenzy/next` with App Router support and middleware
- [ ] `@idenzy/nuxt` module and composables
- [ ] `@idenzy/node` server SDK: JWKS verification, webhook verification, management API
- [ ] SDK conformance suite that every client must pass
- [ ] `idenzy init` scaffolding working routes into the customer's repository
- [ ] Starter templates per framework, in `examples/`

### 1.6 Platform

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

- [ ] Angular, Solid, Astro, Remix, Electron, Tauri and Capacitor SDKs
- [ ] Unity and Godot SDKs
- [ ] Kotlin Multiplatform SDK
- [ ] Python, PHP, Ruby, Java, .NET and Rust server SDKs
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

### Docs

- [ ] Per-platform quickstarts
- [ ] "Security model explained"
- [ ] "Why we do not ship UI", the customer-facing version of §1.1
- [ ] Migration guides from each competitor
- [ ] OpenAPI reference and Postman collection
- [ ] MCP server so AI coding tools integrate the SDKs correctly

---

## Parked and deferred

- [ ] TypeScript 7. Released, but `@nestjs/cli` 12 depends on `typescript@~6.0.2` and Nest DI needs
      `emitDecoratorMetadata`. Pinned to 6.0.x; revisit when the Nest toolchain moves.
- [ ] Node version policy: pin to the active LTS line, or track Current for the performance work
      (§16.10).
- [ ] Native SDK repositories (Swift, Kotlin, Dart) as git submodules. SPM, Maven and pub.dev expect
      a repository root, which argues for splitting them out at Phase 2 (§16.9).
- [ ] Table partitioning migrations are hand-authored, since `drizzle-kit` does not generate them
      (§9.4). Keep them in the numbered sequence and review them as SQL.
- [ ] Open decisions 1 to 10 in §16, to be closed before Phase 0 ends.
