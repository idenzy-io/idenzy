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
rate-limit fallback, Secret Manager loading, OpenAPI generation, distroless images and
Binary Authorization. The audit trail is no longer among them: flows write to the outbox
and the relay in `apps/workers` drains it into the hash-chained table, so `audit_events`
has rows in it for the first time. An interceptor that audits every mutating route rather
than every flow is still owed. None of them blocks Phase 1 starting.

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
- [x] `OrgContext`, `UnitOfWork.runForOrg` and `OrgRepository`, the control plane's own tenant
      key (ADR-0011). The org plane holds the team and the money, so it gets the same two
      lines of defence the project plane has rather than a predicate somebody has to remember
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
- [x] Revocation set: write, query and the signed endpoint (§4.2, ADR-0009). Not cacheable as
      §4.2 sketched it: the payload names users and times their security events, and a project
      id is the `aud` of every token we sign, so it takes a secret key and an ETag keeps
      polling cheap instead of a CDN

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

**Status.** 1.1 and 1.2 are done. Social sign-in works end to end for all eighteen social
providers in the enum, and account linking is closed along with it. The nineteenth name,
`oidc`, is the generic enterprise connector and belongs to phase 4.

What each provider does and does not assert about an address is in its own docstring,
because that field alone decides whether a sign-in may take over an existing account. Ten
of them state it and eight do not, and the eight report unverified rather than assume: an
assumption is not an assertion.

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
from phase 3 for the same reason.

The SSR helpers are five: Next, Nuxt, SvelteKit, Astro and Remix. SvelteKit came forward
from phase 2 and Astro and Remix from phase 3, because once Next and Nuxt had worked out
what an SSR seed is, each of the other three was fifteen lines around
`AccessTokenVerifier` and a framework's own request object. That closes every Tier-1 web
target in §3.3 and the whole Edge/SSR row with it.

The conformance suite that holds them to the same behaviour is in, and the five browser
bindings pass it. `idenzy init` and the starter templates are in too, and they are one
implementation: `examples/` is generated from the templates the CLI scaffolds from, so the
starter a customer reads cannot drift from the one they are given. What is left in 1.5 is
the half of `@idenzy/node` that waits on 1.6: webhook verification and the management
client have no server halves to talk to yet.

### 1.1 Core auth flows

- [x] Abstract `AuthFlow` with the inherited `issueSession()` path (§9.5). The base also
      owns MFA gating, which phase 2 turned from a throw into a challenge: `authenticate`
      answers with a session or with the factor still owed (ADR-0010)
- [x] `PasswordFlow`: Argon2id, HIBP k-anonymity check, timing-equalized failures. Split
      into `PasswordSignUpFlow` and `PasswordSignInFlow`, both `AuthFlow` subclasses
- [x] Sign-up, sign-in, sign-out, session listing, session revocation
- [x] Refresh token rotation with family-based reuse detection, and the attack test
- [x] `EmailOtpFlow`, the default passwordless path. Signs in and signs up, because the
      code proves the same thing either way; an address proved this way is stored verified
- [x] `MagicLinkFlow` redirecting to a registered customer URL with a single-use code (§4.7)
- [x] Password reset and email change, both requiring confirmation on old and new addresses.
      Email change now has the step-up §4.5 asks for: a recent factor verification, checked in
      the service performing the change rather than in a guard, because a guard would have to
      run after `SessionGuard` and getting that order wrong is a silent bypass
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
- [x] The provider tail from §4.6 is closed: Facebook, Discord, Twitch, LinkedIn, X,
      GitLab, Bitbucket, Slack, Spotify, Notion, Figma, Kakao, LINE and Zoom. Most are an
      endpoint pair and a profile mapping, and the base absorbed what the exceptions had in
      common: `clientAuthentication` moves the secret into the header and out of the form
      together, because RFC 6749 forbids presenting it twice and six providers require
      that, and `tokenEncoding` exists for Notion alone
- [x] Four of them are worth reading before adding a fifteenth. Slack's member id is unique
      only inside a workspace, so the workspace joins the subject and an assertion naming
      none is refused rather than keyed on the member alone. Kakao states verification in
      two fields, and the second goes false when the address has moved to another Kakao
      account. Zoom states it as 1 or 0, so it is compared and not read for truthiness.
      Notion's profile arrives inside the token response, because the call that looks like
      the profile endpoint describes the integration's bot and would hand every user of one
      integration the same account
- [x] GitLab's instance is a project setting, and so is its issuer. Self-managed GitLab is
      the common case for the customers who ask for it, and the value is refused unless it
      is plainly an https origin, because it is the host a client secret gets posted to
- [x] Linking a provider to a signed-in account is `POST /link` returning JSON, because a
      browser navigation cannot carry an access token. The user id comes from the session
      guard and is pinned to the flow, so the callback links to the caller rather than to
      whoever the provider turns out to be

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
- [x] Passkey as a second factor and for step-up. It is the one factor whose proof is a
      ceremony rather than a code, which is what widened `MfaFactor` from a string to the
      protocol's proof union. It never demands a challenge: a credential enrolled to sign in
      with must not silently start being demanded on top of the account's password, so
      `demandsChallenge` separates what turns MFA on from what may answer it. Its nonce is
      its own ceremony kind, pinned to the user the challenge already named, because one
      minted here must not be spendable at the door where naming no user is the point

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
- [x] A JWKS outage no longer takes a Next application down. `sessionFor` and `session`
      are seeds and answer null for an unreadable key set, like the other four helpers;
      `verify` still throws, because authorisation code told "no claims" when the truth
      is "cannot tell" refuses the right people for the wrong reason. `protectRoutes` is
      built on `verify` for that third answer and returns 503 with a `Retry-After` rather
      than redirecting, since a redirect to sign-in during an outage signs everybody out
      for the length of it. `onUnverifiable: "allow"` is the named loose choice
- [x] `@idenzy/nuxt` module and composables. Given a project id the server verifies the
      cookie itself and seeds the payload, so the browser hydrates from the snapshot the
      HTML was rendered from. One client per request, never a module singleton
- [x] `@idenzy/vue` plugin and composables
- [x] `@idenzy/svelte` context and stores, and `@idenzy/svelte/server` for SvelteKit: a
      `handle` that verifies the session cookie and seeds `event.locals.idenzy`, which a
      layout load hands the browser. `@sveltejs/kit` is not a dependency, because its types
      arrive with vite and a Svelte plugin behind them; the handle is generic in its event
      instead, which is what keeps it assignable to Kit's own `Handle`
- [x] `@idenzy/angular` provider and signals. Pulled forward from phase 3, because the
      shared session store made it an afternoon rather than a project
- [x] `@idenzy/astro` middleware and `@idenzy/remix/server`, both pulled forward from
      phase 3, and both the SSR seed alone. Astro gets no browser half because an island
      is React, Vue, Svelte or Solid and the customer already picked one; Remix gets no
      `.` export because a loader shares a file with its component. Remix memoises its
      answer weakly per request, so a page's parallel loaders cannot straddle the token's
      `exp` and render from two answers
- [~] `@idenzy/node` server SDK. Access-token verification is done: remote JWKS with the
      cache and the one refetch a rotation needs, `aud` required because one issuer serves
      every project and the audience is the only thing separating tenants, and reading the
      token out of a request so SSR costs no round trip. `RevocationCache` is done too, and
      is what lets a five-minute token behave like a sixty-second one without asking us
      anything on the request path. Webhook verification and the management client wait on
      their server halves, which are 1.6 and not built yet
- [x] Every way in returns `AuthResult`, a union of a session and the challenge still owed.
      The challenge carries `submit` rather than a bare id, because that call is the one that
      creates the session and therefore the one the device name has to ride on: a name sent
      only on the first request would leave every MFA user's device list a column of blanks
- [x] SDK conformance suite that every client must pass. `BindingConformanceSuite` in
      `@idenzy/sdk-conformance` is ten cases over an adapter each binding provides, and the
      five browser bindings run it; Next and Nuxt inherit it from React and Vue. Its own
      tests run it against a reference binding and four broken ones, so the suite is known
      to fail when a binding drops a null seed, collapses `loading`, publishes the client's
      opening position over a seed, or leaves a listener on a client it no longer watches
- [x] `idenzy init` scaffolding working routes into the customer's repository. `@idenzy/cli`
      detects the framework from `package.json` and writes sign-in, sign-up, OTP and OAuth
      routes plus the environment keys they read. A file already there is kept rather than
      overwritten, because the second run is the one that would take a restyled sign-in page
      with it, and a secret key is refused on its prefix before anything is written
- [x] Starter templates per framework, in `examples/`: Next, Nuxt, SvelteKit, Vue and React,
      generated from the `init` templates so the copy a customer reads first cannot drift
      from what the CLI writes. CI runs `pnpm examples:check` and fails when the two disagree

### 1.6 Platform

- [x] PKCE on our own exchange codes, for OAuth and deliberately not magic links: a link is
      clicked in a different browser from the one that started it, so a verifier held by the
      starter would fail the normal case every time. Verified after the code is consumed, so a
      wrong verifier burns it
- [x] `X-Idenzy-Publishable-Key`, so a browser can name its project while `Authorization`
      carries the user's token. First-present-wins, and `pk_` only
- [x] Browser origins as their own exact-match allowlist (`project_origins`, ADR-0006), and
      cross-origin access with credentials. Enforced on the actual response; the preflight is
      strict only where `Host` names a project, because it cannot see the key header. The list
      is writable now: `GET/POST /v1/orgs/:orgId/projects/:projectId/origins` and `DELETE
      .../origins/:originId` on the management API, a developer to write and a viewer to read.
      `browserOriginSchema` is where the rules live — https only, no wildcard, nothing after
      the host, loopback refused because the deployment allows it in code outside production —
      and it canonicalises to what a browser actually sends, so one origin cannot become two
      rows. Nothing caches the list: the resolution functions read `allowed_origins` per
      request, so an addition is live on the next one. Verified end to end, which for this list
      means the auth API answering a request from a newly allowed origin with
      `Access-Control-Allow-Origin` and an unlisted one without it, at the same status
- [x] Web first-party cookie mode: `__Host-idenzy-refresh` for the opaque credential and
      `__Host-idenzy-session` for the access token, so SSR verifies offline with no network
      call. CSRF double-submit, Origin and Fetch-Metadata checks, all applied by one
      interceptor and one guard rather than per route. Header mode stays the documented
      cross-site fallback
- [x] `GET /v1/users/me`, and `includeUser` on refresh, so an SDK boot is one round trip
- [x] Reuse telemetry on `security.refresh_token_reused`. Nothing branches on it (ADR-0007)
- [~] Cookie mode is implemented but unusable in production until custom auth domains exist:
      `SameSite` is a site rule, so it needs the auth API to be same-site with the app. Our
      own panel is the first deployment that will have one — `app.idenzy.dev` to
      `auth.idenzy.dev` — and it already runs in cookie mode locally, where loopback is
      same-site by accident and the transport guard's eligibility check is skipped. What is
      missing is the domain itself and the `project_domains` row that marks it verified
- [x] Project creation, API keys, custom auth domain provisioning. Project creation is in:
      `POST /v1/onboarding` makes the organisation, its owner and its first project in one
      transaction, `POST /v1/orgs/:orgId/projects` adds another, and `GET /v1/regions`
      offers only the cells we actually run. A person who registers directly gets their own
      organisation; a person who accepts an invitation joins one and never comes through
      here. API keys are in: issued once, stored as a digest, revoked rather than deleted,
      and every route scoped through `ProjectScope` so a project outside the caller's
      organisation is not found rather than refused. Custom auth domains are in too: a claim
      mints the two CNAMEs Certificate Manager and the load balancer need, and `POST
      .../verify` resolves them against real DNS. Issuing the certificate is not ours and is
      not done, so `verified` means the records are in place and no more. The management API has
      a spine now: config, persistence, the error contract, and a guard that verifies a
      dashboard access token with `@idenzy/node` — the same server SDK we sell, which is
      the most honest test of it we have — then resolves which organisation the request
      acts on and binds `app.org_id` (ADR-0011). `GET /v1/orgs` and `GET /v1/orgs/:orgId`
      prove the chain end to end. The three things in the title are next, in that order
- [~] Webhooks with HMAC signing, retries and replay safety. **The architecture is settled in
      ADR-0012 and the numbers are in it**: at the 1000-project, 10M-MAU shape the design target is
      100M deliveries a month, and the marginal cost of a correctly shaped pipeline is under $20 —
      dominated by egress, because we are being paid to make HTTP requests. What would have cost
      hundreds, and shared IOPS with sign-in, is logging every delivery in Cloud SQL for thirty
      days, so delivery is a queue and not a log: Postgres holds open deliveries, terminal ones are
      summarised into a 72-hour partitioned window, counters do the health figures, and the long
      history belongs to the analytics store. Cloud Tasks is the retry timer only — the first
      attempt is inline in the relay that already holds the batch — because a queue round trip per
      delivery is $80 a month to move work we were holding. The contract is in
      `@idenzy/protocol/schemas/webhooks` and is now the single copy: envelope, headers, the signed
      string, the 300-second tolerance, the published retry schedule, the event catalogue and the
      SSRF rules for an endpoint URL. `WebhookSigner` is the abstract family PROJECT.md 7.2 asks
      for with `Sha256WebhookSigner` in it, and `verifyWebhook` in `@idenzy/node` is the verifier a
      customer runs — which answers the first P1 on notes/webhooks.md, because the example that
      contradicted its own header is now a tested function rather than a snippet. Writing the
      signer caught two bugs worth keeping: the base class labelled every scheme `sha256=`, and the
      verifier could not read a `Headers` object, which is the shape Hono, a Next route handler and
      a Cloudflare Worker all hand over. Custody is settled too, and it revises PROJECT.md 12: the
      secret is **encrypted** with the project's data key rather than hashed, because a digest
      cannot sign — we can sign and we choose not to re-reveal, which is the distinction the second
      P1 asked for. The schema is in, across migrations 0040 to 0042: `webhooks` carries the
      encrypted secret, the previous one and its overlap deadline, the description, the all-events
      flag, why it is off and the breaker's durable counter; `webhook_deliveries` is the working set
      — status, sequence, a bounded attempt log, `next_attempt_at`, and a payload that is nullable
      because it is cleared the moment the delivery is terminal; and `webhook_endpoint_stats` is the
      daily rollup that keeps the health figures off a scan of the window. `Retention.Hours72` is a
      new tier rather than rounding the window up to `Days30`, because the data map is the answer to
      what we keep and for how long. Deliveries are deliberately not partitioned yet: daily
      partitions dropped by a retention pass are the plan, and shipping them before the pass that
      maintains them is a table that stops accepting inserts on a date nobody wrote down, so they
      land with the pipeline. Writing `0042` also corrected the guide's own advice — copying 0004's
      dynamic grant blocks re-grants the two verbs 0030 withheld from every audit partition and the
      delete `payment_provider_events` must refuse, which the append-only tests caught on a fresh
      database. Next, in order: the endpoint and delivery repositories, the management API routes
      the panel's store needs, then the pipeline itself — fan-out relay, dispatcher, Cloud Tasks
      adapter, per-endpoint in-flight caps and the breaker at 20 consecutive failures. Known gap,
      recorded rather than closed: a
      hostname that *resolves* to a private address is not caught by parsing, so the dispatcher
      owes a resolve-and-refuse check at delivery time (ADR-0012)
- [ ] Usage metering and the MAU HyperLogLog sketch
- [~] `client` panel v1: users, sessions, providers, templates, keys, usage. Every screen is
      built. Sign-in is real: the panel authenticates through `@idenzy/js` against our own
      auth API in cookie mode, so the refresh token is a `__Host-` HttpOnly cookie no script
      can read (ADR-0008), and a global middleware decides who sees which half of the panel.
      Five stores are off fixtures now: the organisation and project lists, API keys, auth
      domains and the CORS allowlist — claiming a hostname, the DNS check and removing one are
      management API calls, and the panel no longer mints a record value or decides that a
      domain is verified. The origins screen writes the real list too, and what an origin *is*
      now comes from `browserOriginSchema` rather than from a second copy of the rule in the
      panel, so the dialog accepts exactly what the API accepts and previews exactly what it
      stores. What the wiring cost the screen was two claims it could no longer support: a
      resolved authorisation record is not an issued certificate, and nothing checks DNS on a
      schedule, so a check happens because somebody asked. A refusal now carries the
      contract's own code into the panel (`refusalIn`), which is what lets a dialog say "that
      hostname is already claimed" rather than "something went wrong" — every screen built on
      `managementMessage` was answering with the fallback before it, because a failed fetch
      hands its caller a status line and a status line has no code. The remaining stores are
      placeholders, and each one waits on an endpoint rather than on the panel
- [ ] Cloud Armor rules and application rate limits

---

## Phase 2: Public launch (8 weeks)

**Status.** Claim templates are in on the server side, which is what finally makes an access token
carry something a customer's own authorisation code can branch on. It is configuration
rather than a hook and that is the reason it is affordable: the user row is already loaded
and the template is one primary-key read, where the synchronous `customize-claims` hook in
phase 3 puts a customer's own HTTP round trip inside every sign-in.

The rule worth repeating is the one about direction. The user fields a claim may read are
an allowlist and it is exactly what the profile endpoint already returns, so a column added
to `users` tomorrow is not publishable until somebody adds it to the list. A denylist would
have made a password hash claimable the day it was forgotten.

MFA is the second thing to land here, and it changed the shape of every way in: an authentication now answers with a session or with the second factor
it still owes, which is a discriminated union on the wire and in every SDK rather than an
error (ADR-0010). A first factor that verified is not a failure, and a page that had to catch
one would put the normal path of every MFA sign-in in the same handler as a wrong password.

`AuthFlow` finally uses the slot it has had since phase 0. The gate sits where the throw
stood, after `verify` and before anything that creates a session, and it answers null in two
cases that are worth stating: a subject that already proved a factor age owes nothing, which
is what stops a passkey ceremony being followed by a demand for a code, and a user with
nothing enrolled owes nothing, because a challenge nobody can answer is a sign-in that cannot
be completed rather than one that is refused.

Three factors are wired and they are not the same kind of thing, which the family had to
learn. A proof is not a string: TOTP and recovery codes take one, a passkey takes a signed
assertion, so `MfaFactor` takes the protocol's discriminated union and every factor refuses
one meant for another in its first line. And holding a factor is not the same as owing one:
`demandsChallenge` is what separates an authenticator, which turns MFA on for the account,
from a passkey, which answers a challenge something else demanded. Without that split,
enrolling a passkey to sign in with would silently change what every password sign-in on
that account does.

`factorVerifiedAt` replaced `requiresMfa` on the subject and the direction is reversed on
purpose: a flow no longer says whether a factor is owed, which is the gate's business, and
instead says whether it proved one itself. That is what feeds the `fva` claim, which had been
declared in `TokenIssuer` since phase 0 with nothing to set it, and it is what step-up is
compared against. Changing an address now asks for a recent factor, which is the §4.5
requirement that had been outstanding since phase 1.

The SMS half of the first three items is in, end to end: a customer can start a code over SMS,
verify it through the same call the email channel uses, and be signed in or signed up on a
number nobody had before. What sits in front of that send is the point of the work, because
SMS is the one channel where a request costs us money before it reaches anybody.

The controls are ordered rather than assembled. Placing the number is free and settles two
refusals on its own, attestation runs before any counter so nobody can burn a stranger's
allowance by naming their number, and the counters run last because they are the only checks
that write. All of them are strict: a window we cannot read is a send we do not make, which
is the opposite of the fail-open that is right for a sign-in attempt.

What is deliberately not done is named rather than quietly folded in. There is no vendor
adapter, for the same reason there is no SES one: the base and the conformance suite are what
Twilio or AWS End User Messaging has to satisfy either way, and nothing is deployed to hold
their credentials. There is no attestation provider either, so a project whose policy requires
one sends nothing until reCAPTCHA or Turnstile is wired, which is the honest failure. WhatsApp
is the third name in the channel enum and is untouched: its Cloud API sends pre-approved
template messages rather than the free text this path renders, so it is a provider and a
template pipeline of its own rather than a branch in the OTP flow.

- [~] SMS and WhatsApp OTP with the full fraud control set (§4.8). SMS is done and WhatsApp
      is not started
- [~] `SmsProvider` base, Twilio and AWS End User Messaging adapters, `ProviderRouter`. The
      base, the router and the development transport are in, along with the conformance suite
      that holds an adapter to the ordering in `send`. The router does not retry: a dispatch
      that failed has already reserved the spend and cannot know whether the message went out,
      so failover happens on the next request
- [x] Spend caps, country allowlists and pumping detection. The cap is durable in Postgres
      rather than cached, because a cache outage must not be able to lift a spend limit. The
      allowlist is ISO country and defaults to empty, and the geography reads full metadata so
      allowing the United States does not thereby allow every Caribbean range on +1. Pumping
      is three signals: a per-number ceiling, a per-address ceiling, a thousand-block counter
      for the consecutive numbers that dodge both, and the send-to-verify ratio for a run that
      has defeated everything else and still cannot make anybody type the code in
- [~] TOTP MFA, recovery codes, step-up authentication and the `fva` claim. TOTP, recovery
      codes and passkeys are done and pass `MfaFactorConformanceSuite`; SMS is the one name in
      the enum that is not wired, and it waits on a vendor adapter like the OTP channel does. TOTP is RFC 6238 with the document's
      own vectors in the tests, and `verify` returns the step a code came from rather than a
      boolean, because a code is valid for its whole step and the only defence against a
      shoulder-surfed one is refusing a step already spent. Recovery codes are 100 bits, which
      is what makes SHA-256 defensible where a six-digit OTP needs Argon2id; a memory-hard hash
      could not be used here anyway, since a submitted code is checked against every unspent
      code the user holds. Enrolment is two calls, because the second is what proves the secret
      reached the authenticator: a factor usable from the moment it was generated would let a
      user whose QR code failed to scan lock themselves out at their next sign-in
- [ ] Step-up is real but it is worth exactly as much as the second factor behind it. A user
      with nothing enrolled passes, because a step-up asks for something the caller holds and
      demanding one from somebody who holds nothing would lock them out of their own address
      for ever. Re-authenticating with a password instead is the honest fix and is not built
- [ ] A project-level "require a second factor of everybody". Today MFA is owed because the
      user enrolled something, which is per user rather than per project
- [~] Customer-defined claim templates. The server half is in and all four rules with it:
      the reserved names live in `@idenzy/protocol` so a dashboard and the issuer cannot
      disagree, a required claim that resolves to nothing fails the issue rather than
      emitting a token without it, `metadata_private` needs an acknowledgement and what is
      stored is when it was given, and the bytes are capped twice because a save sees only
      names and a render is the first thing that sees a value. A fifth rule the plan did not
      name: the claimable user fields are an allowlist and it is exactly `publicUserSchema`,
      so a column added tomorrow is not publishable until somebody adds it there. What is
      left is the dashboard screen, which is the `client` panel
- [ ] The project-config cache PROJECT.md 4.2 assumes. Applying a template is one
      primary-key read per token today, which is honest but is not nothing on the refresh
      path. Nothing else wants a cache yet, so it waits until something does
- [ ] Flutter, iOS, Android and React Native SDKs. Vue and SvelteKit landed in phase 1
- [ ] Custom email domains with guided DKIM setup
- [ ] Migration importers: Firebase, Supabase, Auth0, Clerk, Cognito
- [~] Billing on Stripe, metered against usage. The schema half is in: the wallet, the
      cards, the automatic rule, the top-ups, the invoices and their per-project lines, all
      keyed on `org_id` and isolated by the control plane's own RLS key (ADR-0011), with
      repositories whose races are closed by single statements rather than by read-then-write.
      Money is integer cents throughout and the four rules that cost money if broken are
      constraints: one default card, one owner, a grant that cannot go below zero, and an
      automatic rule that cannot add less than it triggers on. What is not built is anything
      that charges: no Stripe client, no checkout, no webhook receiver, no metering job
      writing `credit_grants`, and `PAYMENTS.running` in the panel is still false. The tables
      `payment_provider_events` and `top_ups` exist precisely so the webhook half can be
      idempotent when it lands
- [ ] `admin` panel v1: tenancy administration, abuse response, spend caps
- [ ] Status page and public incident communication
- [ ] External penetration test
- [ ] SOC 2 readiness assessment against the §4.13 architecture
- [ ] Public comparison page, honest about the UI gap (§15)

---

## Phase 3: Breadth (12 weeks)

- [ ] Solid, Electron, Tauri and Capacitor SDKs. Angular, Astro and Remix landed in
      phase 1
- [ ] Unity and Godot SDKs
- [ ] Kotlin Multiplatform SDK
- [ ] Python (Both async and sync), PHP, Ruby, Java, .NET, Go and Rust server SDKs
- [ ] Second region cell and the residency routing rules (§4.13.5)
- [ ] App attestation: App Attest and Play Integrity
- [ ] Device-bound refresh tokens with proof-of-possession
- [ ] Security center: breached password alerts, impossible travel, attack dashboards
- [ ] Synchronous customer hooks with a fail-closed deadline

### 3.1 Logging (a metered product, priced per GB)

The first line we sell that is not a per-user or per-message one, so it is a billing
decision before it is a feature. The panel already carries the meter: `apps/client`'s usage
screen lists it, charts it and shows it on the bill at a **provisional** $0.30 per GB with
the row marked "not billed yet", so a customer meets the line before an invoice does. That
rate is a placeholder and closing it is the first task here.

- [ ] **Decide the price per GB and whether there is a free allowance**, then replace
      `LOGGING_PRICE_PER_GB` in `apps/client/app/utils/usage.ts` and drop `provisional`
      from the `logging` meter. Everything else on that screen already reads the real
      rates from the screens that own them, and this is the one number that does not.
- [ ] Meter by **bytes ingested rather than bytes stored**, so a query costs nothing to
      run and a customer's bill does not move when they search it. `usage_daily` gains a
      `log_bytes` column, declared through `classified()` like every other (§4.13.2).
- [ ] Ingestion path: structured application logs and delivery events onto the existing
      Pub/Sub fan-out (§5.2 lever 6), never inline on the request path.
- [ ] Retention by compliance tier, enforced by dropping partitions rather than by mass
      deletes, the way `audit_events` already is (§4.13.3). Retention changes what is
      stored and must not change what was metered.
- [ ] A per-project daily ingest ceiling with an alert and a hard stop, on the shape
      `sms_policies` uses for the spend cap (§4.8): this is the second channel where a
      request costs us money before anybody reads it, and the failure mode is an invoice.
- [ ] Search and export through the management API. The audit trail is hash-chained and
      logging is not: they are different products with different guarantees, and the panel
      must not let one read as the other.
- [ ] Usage screen follow-ups once the meter is live: fill the `logBytes` series in
      `apps/client/app/stores/usage.ts` (it is deliberately zero today rather than
      invented), and add the ingest ceiling to the free-tier card.

### 3.2 Analytics on ClickHouse

**Decided: analytics and log storage are ClickHouse, not Postgres.** Everything the panel
shows as a metric, a chart or a trend reads from it once it exists. Postgres keeps the
things it is good at — the tenant tables, the money, the hash-chained audit trail — and
stops being asked to answer aggregate questions over event data it was never shaped for.

What the panel does today is the starting point rather than the design. `usage_daily` is a
daily rollup per project with a HyperLogLog sketch for MAU, and the overview, usage and
activity screens read placeholder stores on top of it. Those screens are what has to keep
working, so the split below is by which question is being asked, not by which screen asks.

- [ ] Decide what stays in `usage_daily` and what moves. The billing rollup is a strong
      candidate to stay: an invoice is a financial record, it has to agree with the ledger
      in the same transaction that writes it, and it is one row per project per day rather
      than an analytical volume. What moves is everything the reader explores rather than
      is billed for.
- [ ] Ingestion, on the Pub/Sub fan-out the logging product already needs (§3.1) rather
      than a second path. One pipeline carrying both, with the destination table differing,
      not two ways for an event to reach the analytics store.
- [ ] Tenant isolation with no RLS to lean on. This is the part that needs a decision
      before code: ADR-0003's second line does not exist in ClickHouse, so the `project_id`
      predicate is structural in the query layer or it is nowhere. Whatever replaces it —
      a row policy, a per-tenant view, a query builder nothing can bypass — is an ADR, and
      an analytics store that can answer across tenants is the same incident class as a
      Postgres query that forgets a `where`.
- [ ] Residency: a cell is an independent stack (§4.13.5), so an EU project's events go to
      the EU cell's ClickHouse and a cross-cell query is not a thing that exists.
- [ ] Column classification. `classified()` is a Drizzle wrapper and ClickHouse is not
      Drizzle, so the compliance generators reach none of this as it stands. Analytics
      events carry IP, user agent and user ids — real personal data with a real retention
      obligation — so either the generators learn a second source or the schema is declared
      somewhere they already read. Not optional: a column outside `classified()` escapes
      the RoPA, the data map, the log allowlist and the DSR field lists at once (§4.13.2).
- [ ] Erasure and retention: a data-subject erasure has to reach the analytics store too,
      and ClickHouse mutations are not row deletes. TTL by partition plus a delete path
      that the DSR handler can actually call, or the erasure promise is only true of
      Postgres.
- [ ] Panel wiring, last. `apps/client`'s stores are placeholders behind real screens, so
      the swap is a client change rather than a screen change — which is the point of
      having built them against a store rather than against a query.

---

## Phase 4: B2B (12 weeks)

- [~] Organizations, memberships, roles and permissions. `org_members` and
      `org_security_settings` are in, with the four roles in `@idenzy/protocol` and the
      one-owner rule held by a partial unique index rather than by application code. The
      permission matrix itself is still the panel's, and the management API that would
      enforce it is not built
- [~] Invitations. `org_invitations` and its repository are in, including the
      `resolve_open_invitation` function a link has to go through because the person
      following it is not in the organisation yet. Nothing sends the email
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
- [~] Audit hash-chain verifier running on a schedule. `verifyAuditChain` and
      `audit_chain_for` exist and the relay's tests use them to catch an altered entry and a
      removed one; what is missing is the job that runs it without being asked. The value of
      a hash chain is entirely in somebody checking it
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
- [x] Consume the revocation set from `@idenzy/node` and the SSR helpers. Revocation was
      already immediate against our own API, because `SessionGuard` reads the session row; it
      was not immediate for anything verifying offline, which is the cost of zero-network-call
      SSR and the reason the default token TTL is short. `RevocationCache` closes that gap
      without giving offline verification up, and it is opt-in everywhere. Four helpers take a
      built one; Nuxt builds its own from a server-only secret key, because module options are
      serialised into the build and cannot carry a live object. A revoked session is a
      credential read and refused, which is what keeps it out of `protectRoutes`'s
      "cannot tell" branch and out of what `onUnverifiable: "allow"` waves through

### Docs

- [ ] Per-platform quickstarts
- [ ] "Security model explained"
- [ ] "Why we do not ship UI", the customer-facing version of §1.1
- [ ] Migration guides from each competitor
- [ ] OpenAPI reference and Postman collection
- [ ] MCP server so AI coding tools integrate the SDKs correctly

---

## Parked and deferred

- [x] **The audit hash chain has its total order, and the relay that builds it.** `seq`
      comes from one cluster sequence, so "the newest entry for this project" is a question
      with one answer where `created_at` tied at millisecond precision. The relay in
      `apps/workers` is the chain's single writer, which is what the fork problem actually
      needed: serialising on the request path would have queued every sign-in for a busy
      project behind the one before it. What is left is the scheduled verifier, below.
- [ ] `pnpm dev` cannot start `auth-api`, `management-api` or `workers`. Their dev scripts
      run `node --watch src/main.ts`, and Node's type stripping does not rewrite a relative
      `./app.module.js` specifier to the `.ts` file beside it, so the process dies on
      `ERR_MODULE_NOT_FOUND` before it reaches any of our code. `--experimental-transform-types`
      is gone in Node 26. The workaround is to build and run `dist/main.js`; the fix is a
      watch-and-rebuild dev script or a loader, which is a toolchain decision (§7.5) rather
      than a patch. The `client` panel is unaffected: Vite resolves it.
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
