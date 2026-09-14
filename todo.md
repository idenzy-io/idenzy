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
      need; `pnpm bootstrap` still does the container and migration half separately. The
      three Node services start for the first time: `node --watch src/main.ts` could never
      have worked, because a `.js` specifier does not resolve to the sibling `.ts` and
      strip-only mode refuses the constructor parameter properties every class here uses, so
      `tools/dev/src/serve.ts` pairs `tsc --watch` with `node --watch dist/main.js` and kills
      what it started — two commands joined by `&` in a shell orphan both, measured rather
      than assumed

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
- [x] Terraform skeleton for one region cell: Cloud Run, Cloud SQL, Valkey, KMS, LB, Armor.
      `webhooks.tf` is the first part of it a service actually reads: eight Cloud Tasks queues
      sharded by endpoint id, the service account a retry task is minted for, and the two IAM
      bindings that make it work — all of it free at rest, which is why the retry lane exists here
      while the rest of the cell's compute does not. Still applied to nothing
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
- [x] Instant dev mode restricted to localhost and `*.idenzy.io`
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
- [~] SES adapter, shared sending domain, SPF, DKIM, DMARC. **The adapter is written and
      passes the conformance suite**; the domain and its DNS are not, and nothing has ever
      sent a real message. `SesEmailProvider` is transport only, which is the whole point of
      the base owning suppression, quota and metering — the suite's job is to catch the
      adapter that overrides `send` to add a header and takes the suppression check out with
      it. `@aws-sdk/client-sesv2` is deliberately not a dependency: our entire use of it is
      one POST with a JSON body, which is exactly the shape 7.6's dependency budget exists
      for and the same call `CloudTasksScheduler` was written by hand for. So SigV4 is ours,
      in `packages/providers-email/src/aws/sigv4.ts`, over `node:crypto`. It was cross-checked
      against an independent implementation of the AWS pseudocode written in Python and run
      over the same inputs: the two agree byte for byte, signed-header list and session-token
      header included, and that vector is pinned as a test — a signer tested only against
      itself reproduces its own mistakes. The properties the tests assert are the ones a
      hand-rolled signer gets wrong: `SignedHeaders` naming exactly the headers that are
      sent, `host` among them so a signature cannot be replayed at another region's
      endpoint, and the body signed so the message cannot be swapped after signing.
      `SES_CONFIGURATION_SET` is required rather than optional, because bounces reach the
      suppression list only through a configuration set — a message sent outside one is a
      hard bounce we never hear about, on a domain every project shares. `emailProviderFor`
      enforces all four variables or none and **names the missing one**: three of four would
      otherwise fall through to the development logger, which refuses to construct outside
      development, and the operator would get a crash about logging rather than about the
      variable they missed. The access key is the part that does not match 4.11's zero static
      credentials, and it is named rather than glossed — `AwsCredentialsProvider` is already
      a function returning a promise so that federation through
      `AssumeRoleWithWebIdentity` is a different provider and not a change to every caller.
      What is left: the sending domain with SPF, DKIM and DMARC, and the send still happens
      inline on the request path
- [ ] Move the send off the request path. `Mailer` calls `provider.send()` inside the
      request and so does `Texter`, which was free against a logger and is not against SES:
      it puts a vendor's latency and its outage on the OTP path, and it contradicts 5.2's
      lever 6. The outbox and the relay pattern already exist in `apps/workers`; this is a
      consumer beside `AuditRelay`
- [~] Sender authentication on the shared domain (§4.7). **Done and verified against real DNS**:
      `mail.idenzy.io` is a verified SES identity in `us-east-1`, DKIM is RSA-2048 and reads
      `SUCCESS`, and the custom MAIL FROM `bounce.mail.idenzy.io` reads `SUCCESS` too, which is
      what makes SPF align with the visible sender rather than with an `amazonses.com` envelope.
      DNS is at Squarespace, so the records are hand-kept and are not in `infra/`.
      Two things are deliberately left:
      **(1) DMARC is `p=none`, not `p=reject`.** §4.7 asks for `p=reject` and that is the end
      state, but publishing it before a real message has shown `dkim=pass header.d=mail.idenzy.io`
      turns any misalignment into every one-time code silently going nowhere, on the flow §4.7
      itself makes the default way in. Tighten after the first verified send.
      **(2) No `rua=` reporting address.** Not an omission: RFC 7489 §7.1 makes an external
      reporting address require the *receiving* domain to publish
      `mail.idenzy.io._report._dmarc.<their-domain>`, which we cannot add to `gmail.com`, so a
      personal address there would collect nothing while looking configured. It waits on either a
      mailbox on `idenzy.io` or a reporting service that owns both halves. Aggregate reports are
      not how alignment is being checked here anyway — the `Authentication-Results` header of a
      test send is
- [ ] Get SES out of the sandbox. **First request was DENIED** (case 178931379400154), and the
      reason is almost certainly ours: the request named `https://idenzy.io` as the website and
      that host does not resolve at all — the apex carries NS delegation and our mail records and
      no A record, because the Squarespace site is attached to `idenzy.dev` instead, where it
      serves a "Coming Soon" page. A reviewer opens the URL, gets nothing, and denies. Not fatal
      and not blocking development: the sandbox still sends 200 a day to verified recipients,
      which is more than a developer machine needs. Before re-requesting, `idenzy.io` has to
      resolve and say what the product is — which is the `landing` app, still one `<h1>`, so the
      shortest path is a real page on Squarespace rather than waiting for that
- [ ] Bounce and complaint webhook into the suppression list. The list and its repository
      exist and are enforced, and the adapter now sends through a configuration set so SES
      has somewhere to publish to; what is missing is the SNS receiver at our end
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

- [x] Open decision on domains closed, and the code follows it: **everything is on
      `idenzy.io`**, with `idenzy.dev` redirecting and held defensively. The draft split in
      §16 — `.dev` for developer surfaces, `.io` for marketing and the dashboard — was
      rejected on a point it had missed: `SameSite` is a *site* rule, so `app.idenzy.io` to
      `auth.idenzy.dev` is cross-site and the `__Host-` cookies of 4.3 never flow between
      them. Our own panel is the first cookie-mode deployment there is (ADR-0008), so the
      split would have had us dogfooding the header-mode fallback while selling the cookie
      model. The cost is named rather than swallowed: `.dev` is HSTS-preloaded and `.io` is
      not, so `idenzy.io` wants submitting to hstspreload.org to get the same guarantee.
      The shared sending domain is `mail.idenzy.io` — a subdomain and not the apex, because
      sending reputation is per-domain and a deliverability incident must not reach mail
      from `idenzy.io` itself

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
      own panel is the first deployment that will have one — `app.idenzy.io` to
      `auth.idenzy.io` — and it already runs in cookie mode locally, where loopback is
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
      database. The three repositories are in — endpoints, deliveries and the daily counters — and
      writing their integration tests against a real Postgres found the bug worth finding: a claim
      that stamped the current time left the row it had just taken still due, because `delivering`
      is in the due predicate so a dead dispatcher's delivery can be recovered. Two sweepers would
      have called one customer's endpoint about one event. A claim takes a minute's lease now, and a
      test that fails without it says so. The rest of the layer is one statement per transition for
      the same reason: the fan-out is replayable on a unique index, an attempt is appended in SQL
      rather than merged from a list, the failure counter is incremented in the database, and the
      payload is cleared in the same statement that makes a delivery terminal. The management API
      routes are in too: list, create, patch, pause, resume, rotate-secret, delete and the delivery
      list, all at developer because webhooks sit beside API keys on the panel's matrix. The secret
      appears in exactly the two responses that mint one and is absent from every other, which is a
      property of the service rather than of the storage — and verified as both: the stored
      ciphertext decrypts back to the secret shown once under the project id as additional
      authenticated data, and refuses another project's. Pausing and resuming are routes rather than
      a boolean, because `enabled` alone cannot say whether a person or the breaker switched an
      endpoint off. A test event and a retry are deliberately absent until the dispatcher exists:
      either would write a delivery nothing sends, and the screen already says both are
      unavailable. **The pipeline runs.** The relay maps outbox topics onto public event names,
      fans one delivery out per subscribed endpoint inside each project's own tenant scope — so
      there is no cross-tenant read of anybody's endpoints — and makes the first attempt from a
      bounded pool, with one watermark per topic because `outbox.seq` is global and a shared bound
      would skip a slower topic's events. The dispatcher signs from what is stored, sends, writes
      down what happened and then decides, in that order, so a crash before the write leaves the
      delivery due again rather than lost. The sweeper is the durable half and, in every environment
      without a queue, the only timer — which is correct rather than a gap: Cloud Tasks makes a retry
      punctual, the table is what makes it certain. The SSRF gap ADR-0012 recorded is closed: the transport resolves the
      hostname, refuses unless every address is public, and connects to the address it checked with
      SNI and `Host` set to the name, so TLS still has to be the customer's certificate and the
      rebinding window is gone. The breaker counts **attempts** and not dead deliveries, which the
      integration test is what exposed: a delivery only dies after eight attempts over a day, so
      twenty of those is a month of calling an endpoint that has never answered. Verified end to end
      against a real Postgres and a real HTTP receiver that verifies every delivery with
      `verifyWebhook` from the SDK we publish — our signer and our customers' verifier agreeing over
      a socket, which is the one thing no unit test can say. **The panel is wired**: endpoints and the
      day counters load with the screen, one endpoint's deliveries follow the selection because that
      is the expensive read, and every write is a real call. The figures strip reads
      `webhook_endpoint_stats` rather than counting the deliveries on screen — which was honest only
      while that list was every delivery there had ever been, and would have reported a busy week as
      fifty. `Waiting to retry` gave its tile to `Attempts` for the same reason: attempts against
      deliveries is what says whether an endpoint answers first time. The verifier sample is now a
      call to `verifyWebhook` rather than thirty lines of hand-written HMAC, which is the screen's
      first P1 answered properly — a corrected copy would have been a second implementation to keep in
      step with the signer. `GET .../webhooks/stats` is the one route this needed. Both remaining controls
      work now: a test event and a replay each write a delivery and answer 202, because the control
      plane holds no signing key and no transport — the worker picks it up, so both go down the same
      path a real event does, which is what makes pressing one worth anything. Writing the replay
      found a flaw in ADR-0012 as decided: clearing the payload on *any* terminal outcome made a
      replay impossible to honour, since the one thing it must send is the body it was signed from.
      A delivery that was taken keeps nothing; a failed one keeps its body until the window drops the
      row, which is the case a replay is for. Verified live over ngrok against a real public https
      host: a test event delivered and verified by the SDK, a real `session.created` from the outbox,
      an endpoint that refused once and was retried ten seconds later as attempt 2 of the same
      delivery id, a replay delivered as attempt 9 of the id it already had, a replay of a taken
      delivery refused 409, and the day counters reading 1 delivered / 2 attempts for the endpoint
      that needed a retry. **The retry lane is wired to Cloud Tasks**, which is the last piece ADR-0012
      described and nothing implemented. `CloudTasksScheduler` creates one task per attempt with
      `scheduleTime` set from our own schedule, sharded by endpoint id across eight queues so one
      endpoint's retries are bounded by one queue's dispatch rate rather than the pool's. It is written
      against the REST API with `fetch` and the metadata server rather than `@google-cloud/tasks`: the
      client library brings gRPC and its tree into a service whose entire use of it is one POST with four
      fields (PROJECT.md 7.6). The task carries an address and not the delivery — two ids in their public
      form, no payload, no attempt number, no signature — because the row is the truth about all three by
      the time it fires, and a task carrying its own copy could deliver a body the delivery has finished
      with. Its entry point is the worker's first HTTP surface, which the comment at the top of `main.ts`
      used to deny: health, because a Cloud Run service has to listen on `$PORT` to be considered up, and
      one authenticated route, because a queue delivers a retry by calling a URL. `node:http` and not a
      framework for two routes. The token on that route is verified in process against Google's own keys
      — signature, audience, and the service account's email, because any Google identity can obtain a
      token for a public audience — rather than trusting `roles/run.invoker` alone, which is a deployment
      setting one flag away from a public endpoint that dispatches deliveries. The claim is what makes the
      lane safe to call twice: `claimIfDue` is one statement with being-due in the predicate, so a
      duplicate task, an early duplicate and a sweeper that got there first all lose the same way and
      nobody's endpoint hears about one event twice. Five environment variables, all of them or none: four
      of five is a boot failure rather than a silent fallback to the sweeper, because the symptom would be
      retry latency nobody is watching. Terraform is in `infra/terraform/modules/cell/webhooks.tf` and is
      only the free-at-rest half by choice — queues, an identity, IAM; no Cloud SQL, no Memorystore, no
      load balancer — with the queues' own retry policy set to one attempt, since the schedule is ours and
      published and a queue retrying on top of it would double a customer's traffic during an outage.
      Tested as far as it can be without a Cloud project: the request we make is asserted against a local
      stand-in for the API, the verifier is the real one against a key set the test serves, the claim and
      the dispatch run against a real Postgres, and the route itself was exercised live — health open, a
      missing token 401, a token Google did not sign refused with the contract's own code, and no dispatch
      route at all in a deployment without a queue. **What has never happened is Google calling us back**,
      which is recorded in the terraform README rather than implied: nothing here has been applied to a
      real project. **`user.created` has an emitter now**, which is the event every customer builds on
      and the largest of the catalogue's gaps. It is written by `UserRepository.create` rather than by
      a flow, for two reasons that both had to hold: six paths create a user — password sign-up, magic
      link, two OTP channels, an OAuth first link, an anonymous session — so an event each of them has
      to remember is one the seventh ships without (PROJECT.md 7.3), and it has to be in the
      transaction that made the user, or a crash loses the event and a rollback invents one, which
      rules out the `AuthFlow` base that owns the rest of a sign-in's ordering. A test proves the
      rollback case rather than assuming it. The event says "an account exists" and nothing else: how
      the account was created belongs to the `session.created` a moment later, and a bulk import will
      want a path that does not claim six hundred thousand people just signed up. Writing this also
      found the list of gaps wrong — `security.staff_access_granted` was in neither the topic map nor
      the without-emitter list, so a customer could subscribe to an event nobody had noticed nothing
      sends. `webhook-events.test.ts` now asserts the two lists cover the catalogue exactly, because a
      list of known gaps that is itself out of date is worse than none. **What a delivery says is now a
      declaration rather than a side effect.** The outbox payload used to reach a customer verbatim as
      the envelope's `data`, which made one column two surfaces: the reconciler parses raw uuids out of
      those same payloads, so an event carried `userId` as a bare uuid while every other answer this
      product gives says `usr_…`, and reuse detection was publishing a refresh-token family id nobody
      can look up plus `likelyCause`, which is our own guess. `WEBHOOK_DATA_FIELDS` in the protocol now
      names each event's fields, the public form of each id and the sample the panel documents, and the
      relay projects at fan-out — before the delivery row is written, so every retry still signs the
      same bytes. An allowlist for the same reason the log allowlist is one: passing a payload through
      publishes whatever the next person adds to it. Three internal topics collapse into
      `user.updated`, so each now carries `changed` — without it a receiver cannot tell a verified
      address from a changed password, which the single event type had quietly made impossible. The
      reuse event carries the user it belonged to, read before the revoke: "a token for one of your
      sessions was replayed" is only actionable with an account attached. Migration 0044 adds
      `occurred_at`, because the envelope promises the instant the event happened and the dispatcher
      reads only the row — so that promise was the relay's own schedule, seconds out normally and hours
      out after a cold start, and a test now proves an hour-old event arrives saying so. The panel's
      sample body is built by `buildWebhookEnvelope` with `webhookDataSample` instead of being
      hand-written: it had drifted into documenting `occurred_at` and a `data.object` no delivery has
      ever carried, and a test parses it with the envelope's own schema. `pnpm db:migrate` and
      `db:seed` got `--env-file-if-exists` on the way past, because the README's own getting-started
      line could not find `DATABASE_URL`. **The screen says which events are silent**, which it could not
      before: `WEBHOOK_EVENTS_WITHOUT_EMITTER` lived in the worker where only the worker could read it,
      so the dialog offered all thirteen subscriptions as equals while six of them save and never
      deliver — from the outside that is indistinguishable from a broken receiver. It is in the protocol
      now, each event carries a `Not sent yet` tag, and the line under Events names the count for the
      reader who picks "every event" and never opens the groups. Three of the notes beside those events
      also described payloads that never existed — `user.updated` promised "what it was and what it is
      now", `session.revoked` a reason, `session.created` the device name — and now name what the
      projected data carries. The events still without an emitter: deletion and suspension, which need the
      erasure path and a users screen that can ban somebody (nothing writes `banned_until` or
      `deleted_at` today), the three delivery events waiting on the SES and SMS event paths, and staff
      access waiting on the break-glass flow
- [~] Usage metering and the MAU HyperLogLog sketch. **The sketch exists and is written.**
      `usage_daily.mau_hll` had been a column with no writer since the schema landed, and the
      shape is forced by what it has to do: billing needs one number per project per month, and
      a distinct-user list to produce it would be thousands of rows a day recording precisely
      what nobody should later have to hand over or erase. `HyperLogLog` in `@idenzy/core` is
      p=14, so the standard error is 0.81% — 400 users at the free-tier boundary where nothing
      is charged either way, and $20 a month at 1M MAU, unbiased in both directions. The sparse
      form is what makes six years of daily rows affordable: four bytes per touched register up
      to 4096 of them, which is exactly where the dense 16 KiB becomes the smaller of the two,
      and almost every project is under it on almost every day. Small counts read through linear
      counting, because the raw estimator is biased below 2.5m. MurmurHash64A rather than a
      convenient hash, since one that clusters does not lose precision symmetrically — it
      undercounts, the same way, every month. **Union is a per-register maximum, and everything
      above leans on it**: the same user added twice, the same day merged twice and a flush
      replayed after a crash all leave the same sketch, so no part of the pipeline has to be
      exactly-once to bill correctly. `mergeActiveUsers` is the one method on `usage_daily` that
      cannot be an upsert, because a union is not an operation Postgres knows: the bytes come
      back, merge in process and go down again under the row's lock, or two meters would each
      write the sketch they read and the second would erase the first — silently, and in the
      direction that undercharges. `dailyBetween` hands back the sketch and not a number, because
      a month is the union of its days and never their sum, and an `activeUsers` integer per day
      would make that mistake the natural reading of the type. **What counts as an MAU is
      decided in one place**, `ActiveUserMeter`, and both of PROJECT.md 5.1's exclusions are
      applied at the authentication because neither survives into what is stored: an account is
      free on the day it was created, so an abandoned sign-up costs the customer nothing, and an
      anonymous one counts only once upgraded. `AuthFlow` calls it, which is the point — eight
      flows sign somebody in today and the ninth will be written by somebody who has not read
      this, so a meter each of them had to remember is a revenue line that silently loses a
      sign-in method. Refresh calls it too, after the commit like the revocation publish beside
      it, because a refresh is an authentication for billing and is what keeps a long-lived
      session counted in a month it did not start in; the user is already in hand on both paths,
      so neither costs a read. **The write is buffered, and that is a cost decision with a stated
      failure direction.** A write per authentication would put the busiest row in the system on
      the sign-in path — the same trade ADR-0012 refused for logging deliveries — so
      `BufferedActiveUserMeter` holds a sketch per project-day and flushes on an interval, driven
      by the requests themselves *and* a timer, since a timer alone is unreliable where CPU is
      throttled between requests and requests alone would strand a quiet project's last few until
      the process ends. It costs a bounded undercount when an instance is killed between flushes,
      which is chosen rather than accepted: the alternative is a meter that can overcharge. A
      flush never rethrows, because a billing outage must not become an authentication outage.
      `GET .../projects/:projectId/usage` is the endpoint the panel has been waiting on, and it
      is a service rather than a query the panel could make itself for exactly one reason: every
      row carries `activeUsersToDate` beside its own figure, a real running distinct count, which
      is the level that reconciles with an invoice and the one notes/usage.md asked the chart to
      draw. Its window defaults to the calendar month because the free tier and the invoice both
      reset on the 1st, and the cap is enforced after the defaults rather than in the schema —
      one end given and the other defaulted passes every check a single field can make and asks
      for every daily row a project ever had. It is also management-api's first test, so it
      brought a `tsconfig.test.json` with it. **The sketch does not outlive the month it bills**,
      which answers the only real objection to keeping any of this in Postgres: 16 KiB a day for
      six years is 35 MB per busy project on a primary that is also serving sign-in, and in every
      backup of it. `usage_periods` is one immutable row per project per month — SELECT and INSERT
      only, because a period that could be amended after its invoice was raised is not a record of
      anything — and the closer in `apps/workers` takes the union, freezes the two integers the
      chart needs, and drops the sketches, all in one transaction because either half alone loses
      something. It waits six hours past the month end for the meters to flush, and the other side
      of that window is closed too: a flush landing on a frozen day is dropped rather than putting
      a sketch back on one whose figure is published. `usage_closable_periods` is the cross-tenant
      read it needs, narrowed to a project id and a month like the two SECURITY DEFINER functions
      before it. **Usage is kept at three resolutions and each has its own term**: six months of
      hours, two years of days, six years of closed periods. `usage_hourly` is the finest and it
      stores a *level* rather than a sketch — an hourly HyperLogLog would be seventy megabytes per
      project over its own term, which is worse than the daily problem and for a chart rather than a
      bill. So an hour says how the month's count was climbing and can never say how many distinct
      people were active inside it. It is written once, when the roller first sees it complete,
      because its level and its share of the day's counters are only true at the moment they are
      taken; a worker that was down leaves a gap rather than a fabricated curve, and the traffic
      lands in the first hour recorded afterwards. **A tier nothing enforces is a sentence in a data
      map**, so `UsageRetentionSweeper` came with them: before it, `classified()` published a
      retention answer while nothing ever removed a row, so the real answer was "forever" and the
      printed one was not. It prunes through SECURITY DEFINER functions both because a sweeper has
      no tenant to be scoped to and because `usage_periods` deliberately withholds DELETE from the
      app role — a test asserts the application still cannot remove a closed billing period and that
      the sweeper can. **The screen reads all of it**, and the wiring cost it two things worth
      naming. SMS is counted in messages rather than segments, because nothing counts segments — the money
      is still right, since what a send cost was priced by segment where it was reserved, but the
      quantity column was reporting a number nobody measures. And the sending configuration is
      stated as an assumption: which domain carried an email and whose account carried an SMS are
      not metered, so those two bill lines say they assume our shared domain and our routing rather
      than looking like readings. The 1d range survived after all, on `usage_hourly` rather than on
      a curve, and an hour nothing recorded is drawn as a gap. What is **still** not done: nothing prices MAU or email against a
      plan, so the money on that screen is the panel's own published list rather than a figure any
      system would bill; `assertWithinQuota` still allows everything because a ceiling needs a
      plan; and the analytics half of 3.2 has not started, so the daily series is served from
      Postgres
- [~] `client` panel v1: users, sessions, providers, templates, keys, usage. Every screen is
      built. **Users is off fixtures now**, which is the first of the customer-operations
      family: `GET/POST /v1/orgs/:orgId/projects/:projectId/users` and the five routes under
      it, all at developer because `members.ts` puts "your users and their sessions" at
      owner/admin/developer and a matrix that lies about one row is not worth showing.
      `ProjectUserRepository` is a read model kept apart from `UserRepository` on purpose:
      that one is on the sign-in path and every method is a key lookup, this one scans,
      sorts and joins, and one class would invite a list query from inside an
      authentication. Three of the columns are not columns — the ways in, whether an
      authenticator is enrolled, how many sessions are live — so they are assembled in four
      grouped reads per page rather than four per row. Paging is a keyset on
      `(created_at, id)`: an offset skips a row for every account created behind the reader,
      silently and only under load. Suspension writes `banned_until`, which nothing had ever
      written, and deliberately does **not** end the sessions — it is read on rotation, so
      an issued token lives out its lifetime, and a test says so because the other reading
      is what a screen would quietly promise.
      Four bugs worth keeping. `tenantScope()` names `users.project_id`, so using it for the
      four joined tables emitted `"users"."project_id"` against `identities` and Postgres
      refused the statement — the row policies would have scoped them anyway, which is
      exactly why the second line of defence has to name the table it filters. The panel's
      method vocabulary was a closed union of eight and the API sent `magic_link`, so
      `METHOD_ICONS[method]` was `undefined` and reading `.monochrome` off it threw inside a
      render: the vocabulary is open now and `methodIcon`/`methodLabel` are total, because a
      longer record would only move the crash to the nineteenth provider. The API sends the
      provider's own id rather than a generic `oauth`, since "signs in with GitHub" is the
      fact a support screen needs. And two calls used `.post()` where Fastify refuses a JSON
      content-type with no body — `keys.ts` had already documented that trap and the HTTP
      test found it before the screen did.
      **Sessions is off fixtures too.** `GET .../projects/:projectId/sessions` with
      `userId`, `includeRevoked` and a keyset cursor on `(last_active_at, id)`, and
      `POST .../sessions/revoke` taking a list — a list and not a DELETE per id, because the
      selection bar ends a set and a request per row half-succeeds on a slow link and leaves
      the operator no single answer during the incident that made them press it. Revoking is
      one statement with the already-revoked excluded by the predicate, so two people on the
      same incident are not both told they ended it. The property worth having is
      cross-screen: `ProjectUser.activeSessions` and the rows on this screen now derive from
      the same predicate, so revoking one moves the other — verified live, 2 to 1.
      Two fields are absences rather than guesses, and the generator invented both.
      `deviceBound` is false everywhere because device-bound refresh tokens are 4.4 and phase
      3 with no column to read; `network` is null because the IP intelligence behind it is a
      lookup over a provider we do not have.
      **Import is not a wiring job and was not attempted.** It has no backend at all: no
      table, no worker, no service, nothing server-side mentions it. The screen describes a
      job — file up, a worker parses, rows written, the panel polls — so wiring it means
      building Phase 2's migration importers: an `import_jobs` table through `classified()`
      with its own FORCE RLS and grant migration, upload handling, a parser per source
      (Firebase, Supabase, Auth0, Clerk, Cognito), hash import for bcrypt/scrypt/argon2 against
      `passwordAlgoVersion`, a worker, and progress polling. That is a feature, not a store swap
      **Per-project settings exist now, and the auth API obeys them.** `projects.settings`
      was a jsonb column nothing read except one OAuth flag, so every configuration screen
      edited values the server neither stored nor honoured — the same class of problem as a
      fixture, and a worse one, because the customer believes the door is shut.
      `projectSettingsSchema` is the typed document, `GET/PATCH .../settings` reads and
      writes it (viewer to read, admin to write, because turning password sign-in off
      changes how every one of a customer's own customers gets in), and
      `ProjectSettingsReader` in `auth-api` is what makes it real: `PasswordSignUpFlow` now
      refuses on `enabled`, `allowSignUp` and `minLength` before it hashes anything, and
      honours `breachCheck`; `PasswordSignInFlow` refuses on `enabled` alone. That split is
      deliberate and tested — closing sign-up must not lock out the people already inside.
      The merge is `jsonb_strip_nulls(settings || patch)` in one statement rather than a
      read-modify-write, so two operators saving two screens at once cannot erase each
      other's section, and stripping is what keeps "absent" the only way to say not-set.
      Both the API and the reader parse the stored document rather than trusting it, and a
      document that will not parse resolves to defaults rather than throwing: every default
      is what an unconfigured project already does, so a bad settings blob must not be able
      to take authentication down. Verified live — minLength 20 refused a sixteen-character
      sign-up and accepted a twenty, `allowSignUp: false` refused a new account while an
      existing one still reached the password check, and `enabled: false` refused everybody.
      **Five more sections followed, and the flows obey them.** `otp` (email, SMS and magic
      link, each with its own `enabled` and `allowSignUp`), `passkeys`, `mfa`, `recovery`
      and `lifetimes`. Each channel is refused at the earliest possible point rather than
      the most convenient: the email code before one is generated or hashed, the SMS code
      before `SmsFraudGuard` reaches the spend cap or the counters, the passkey before a
      challenge is minted — a nonce handed out and refused a moment later reads as a broken
      browser rather than as a setting.
      **`lifetimes` is the one that closes a promise 4.2 has been making since phase 0.**
      The access-token TTL was `ACCESS_TOKEN_TTL_SECONDS`, one value for a whole deployment,
      while the document said "customer configurable from 60 s to 60 min". `TokenIssuer.issue`
      now takes an optional per-call lifetime — per call rather than an issuer per project,
      since the only thing that would differ between them is an integer — and clamps it to
      60..3600 itself, because that is the last place before a signature and a token minted
      from a value that got past validation elsewhere is a live credential with a lifetime
      nobody chose. `SessionService` reads the project's windows for the session row too.
      Verified live: 300 by default, 60 and 3600 when set, 90 days refused by the schema, and
      an idle window longer than the absolute lifetime refused by the refine — a project with
      one could never have had it take effect.
      That is two primary-key reads per token on the refresh path, which is exactly what the
      project-config cache 4.2 assumes is for; it now has a single place to land.
      `useSettingsSection` in the panel is one composable behind five stores, because the
      patch semantics are the part worth having once: the API replaces a section whole, so a
      store that sent a partial one would silently reset the fields it left out.
      What each of those screens still cannot do is named in its store rather than implied:
      the passkey relying party is a row in `webauthn_relying_parties` with a unique index
      behind it and has no endpoint, step-up's max age is still deployment-wide, a recovery
      set belongs to a user and `mfa_recovery_codes` has no route, and nothing records when
      a verifier last polled the revocation snapshot — so that timestamp is null rather than
      invented.
      **Social providers are wired too**, which is the last of the settings-shaped screens:
      `GET/PUT/DELETE .../oauth-providers/:provider` plus the return-URI allowlist, all at
      admin — a client secret is a credential the customer obtained from Google and handed
      us, and the return URIs are the exact-match list standing between a callback and an
      open redirect (4.6), so neither belongs at the level that reads configuration to
      integrate against it. `clientSecret` is three states rather than two: absent leaves the
      stored one alone, a string replaces it, null clears it. Absent *has* to mean leave it,
      because the panel has never been allowed to read a secret back and so has nothing to
      resend — treating absent as "clear" would blank a customer's credential every time
      somebody flipped the enabled switch, discovered at their users' next sign-in. Verified
      live: the plaintext never appears in a response, a save without the field kept it, and
      null cleared it.
      Account linking moved with it and is now `settings.linking.autoLink` rather than
      `new AccountLinkingPolicy(true)` bound once at boot — 4.6's rule, which decides whether
      a social sign-in may take over an existing account, was a hardcoded constant.
      **The bug worth recording is how it was found.** `ProvidersService` is the first thing
      in `management-api` to write an encrypted column, and `CryptoModule` exported
      `FieldEncryptor` while nothing had ever imported it — so the binding was dead and the
      service could not resolve. Every unit test passed and every integration test passed,
      because they construct services directly; it failed only when the process tried to
      start. `auth-api` has had a composition-root test since phase 0 and this service did
      not, so it has one now, and `@nestjs/testing` is a dependency of it for the first time.
      One knob is deliberately stored and not yet enforced: `lockout` and `lockoutAttempts`
      need a counter on the sign-in path, which is the rate limiter's shape and not the
      policy's. **The reset path obeys the other three now.** `resetLifetime` replaces
      `PASSWORD_RESET_TTL_SECONDS`, which was one number for every customer on the
      deployment and is deleted rather than left as a fallback — this was its only reader,
      and a second answer to one question is how `SESSION_IDLE_TTL_SECONDS` came to be read
      on rotation while the setting is read on issuance. `signOutOnReset` replaces a
      `signOutOtherSessions` flag the *caller* sent, which let whoever built the reset form
      switch off a protection the account's owner had been shown as on; the field is gone
      from the wire rather than ignored, because one that cannot change an outcome reads as
      a control, and `z.object` strips it so a client still sending it is not refused.
      `notifyOnChange` had no template and no sender at all: `password_changed` sat in the
      enum while `englishTemplates` had no entry for it, so turning the switch on would have
      thrown at send. It is the first built-in that reports rather than invites, which is
      why `layout()` now takes its footer — "you can ignore this, nothing has changed" is
      the standing advice on every other mail and is false on this one. That parameter also
      fixed a live contradiction it exposed: `email_change_old` calls itself a warning and
      leaves that line out of its text body, but its HTML went through the default footer,
      so the mail said "do not confirm, change your password" and then said ignoring it was
      safe. Only `.text` was ever asserted, which is why nobody saw it.
      **Wiring the three found two more the reset path was not obeying**, and the first is
      the serious one: `minLength` was enforced at sign-up and not at reset, so an
      unauthenticated caller holding a link could put an eight-character password on an
      account whose project demands twenty. `breachCheck` was ignored in the other
      direction — consulted unconditionally, so a project that switched it off still paid
      the HIBP round trip and still had its users refused, against a screen promising the
      switch covered sign-up and reset alike. The notification carries no link: the only URI
      we hold is registered for where a reset *token* lands, `withToken` appends one, and
      sending it bare hands the customer's route a request it was never told to expect. It
      never fails the reset either — the password is committed before the mail is attempted,
      so a provider outage reported as a failed reset would send someone round again to a
      form their new password already works against. Six integration tests, each asserting
      the direction that fails rather than the happy path (PROJECT.md 7.4).
      `notifyOnChange`'s reach is the reset path only, because a signed-in change-password
      endpoint does not exist; the screen says so now rather than promising "a reset or a
      change".
      The panel's password-policy store is off its fixture; the stats beside it are not,
      because those are counts over sign-ins and refusals that live in ClickHouse (ADR-0013)
      and wait on 3.2's panel wiring rather than on an endpoint that could exist today
      `add` and `remove` refuse with a reason instead of pretending: creating an account
      needs a `PasswordHasher` the management API does not have, and erasure is the DSR path
      (4.13.6), whose worker does not exist. The remaining stores are placeholders, and each
      one waits on an endpoint rather than on the panel. **Audit is off its fixture now**, which is the
      first of the compliance-shaped screens and the only remaining store whose backend
      already existed: the relay has been writing hash-chained rows since phase 1 and
      nothing could read them but the relay. `GET .../projects/:projectId/audit` at
      viewer, keyset on `seq`. It cost the screen one claim — a bounded read cannot total
      a period, so the strip and the export dialog both say what they are counting — and
      settled two vocabularies into `@idenzy/protocol`, the actor kinds (where three of
      five panel names disagreed with the column and a filter would have matched nothing)
      and the action categories. Sign-in is real: the panel authenticates through `@idenzy/js` against our own
      auth API in cookie mode, so the refresh token is a `__Host-` HttpOnly cookie no script
      can read (ADR-0008), and a global middleware decides who sees which half of the panel.
      Seven stores are off fixtures now: the organisation and project lists, API keys, auth
      domains, the CORS allowlist, webhooks and usage — claiming a hostname, the DNS check and removing one are
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
      hands its caller a status line and a status line has no code. Usage is the latest, and it
      cost that screen three things a placeholder could show and the meters cannot: the hourly
      chart, which a daily rollup cannot support; a segment count, which nothing measures; and
      the sending configuration behind two bill lines, which is now stated as the assumption it
      is. **Settings is the last of the org-shaped screens.** General and Members are on the
      API now: `GET/PATCH/DELETE /v1/orgs/:orgId/projects/:projectId` at viewer, admin and
      **owner**, and `/v1/orgs/:orgId/members` with its invitations, its security setting and
      its transfer. The two rules that keep an organisation usable are the service's rather
      than the screen's — the owner cannot be demoted or removed, and the last project in an
      organisation cannot be deleted — and each is a conflict with a sentence instead of a
      unique-index violation. `remove` answers whether it went, because the screen navigates
      away afterwards and doing that on a refusal reads as a delete that worked.
      Three things the wiring cost, each named on the screen rather than dropped. The General
      page's facts were seeded off a hash of the project id, so a project in `us-east-1` could
      describe itself as Europe and a free one as enterprise — a residency claim invented by a
      PRNG; they come from `/v1/me`, which already carries the same four columns, so the page
      gained no request of its own. **Retention is a server answer with a job behind it**:
      `GET/PUT .../retention` at viewer and admin, `retention_policies` written through an
      upsert, and the hourly sweeper below actually deleting. Every subject comes back whether
      or not the project stored an age, because "kept 90 days because nobody chose" and "not
      swept at all" are different facts — `source` says which, and the row shows a Default
      marker for the first. The vocabulary moved to `@idenzy/protocol`, so the menu offers
      exactly what the API accepts and the default on screen is the one the delete uses. And the invite dialog now says that nothing sends the email,
      because an invitation nobody receives looks exactly like one that was ignored.
      **Two bugs found by wiring it.** `invited_by` and `updated_by` are `org_members.id`
      columns and the controller was passing a `users.id`, so every invitation listed itself
      as sent by "Unknown" — the two ids belong to the same person and are different uuids,
      which is the kind of mistake a join hides until it is read back. And the panel's
      members store answered "who am I" with a constant, then with the owner as a fallback,
      so every rule on the screen was measured against a guess; it is the caller's own
      `memberId` from `/v1/me` now. `org_members.last_active_at` is still written by nothing,
      so the column reads "Never signed in" for the person reading the page
- [x] `SESSION_IDLE_TTL_SECONDS` was read on rotation while the project's setting was read
      on issuance, so a customer who shortened their idle window had it applied when a
      session was created and ignored every time it slid. Found while deleting the reset
      path's equivalent variable. **It was worse than a setting being ignored: the two
      defaults disagreed** — fourteen days from the schema at sign-in, thirty from the
      environment on the first rotation after it — so every session on every project that
      had configured nothing silently more than doubled its idle window the first time it
      refreshed. `RefreshService` reads `lifetimes.idleSeconds` now.
      The Lifetimes screen is what settled the design, because it already promised the
      answer in as many words: an idle window is "read at the next rotation, so it reaches
      sessions that exist", unlike the absolute lifetime, which is stamped at sign-in and
      never moved. Storing the window on the session row would have been cheaper — no read
      on the hot path — and would have pinned every existing session to the policy it was
      born under, which is the opposite of what somebody shortening an idle window is
      asking for. So `ProjectSettingsReader` is on the refresh path now and its docstring
      no longer claims otherwise. One primary-key read, resolved before the transaction,
      and the strongest reason yet for the project-config cache 4.2 assumes.
      `SESSION_ABSOLUTE_TTL_SECONDS` went with it and had been dead already: nothing had
      read it since `SessionService` began stamping the setting. `ACCESS_TOKEN_TTL_SECONDS`
      stays, but only for the deployment-wide jobs — the issuer's own default and the
      revocation set's retention bound — and `REFRESH_TOKEN_TTL_SECONDS` stays because §4.2
      offers a customer no control over it and the screen states it as fixed
- [x] Record `org_members.last_active_at`. The column had existed since 0025 with a column
      on the members screen and nothing that ever wrote it, so a dormant seat and an active
      one read the same — including for the person reading the page, who saw "Never signed
      in" about themselves. `MembershipGuard` writes it now, which is the one thing every
      dashboard request under `/v1/orgs/:orgId` already does.
      **The bound is the whole design.** A write per request would put an UPDATE on the
      busiest row in the control plane to maintain a column the screen reads once a month,
      so the stamp is at most once a day per membership. Deciding that needs the current
      value, and the guard has nowhere else to get it: the check runs *before* `app.org_id`
      is bound, so a repository read would be refused by the policy it is deciding.
      Migration 0053 returns `last_active_at` from `resolve_org_membership` instead — the
      same row on the same index seek, so the common path costs nothing and a member who
      was here an hour ago is decided in memory. The write itself goes through
      `OrgMemberRepository.touch`, which had been sitting there with no callers since the
      members screen was wired, under a bound org context like every other org-scoped write.
      A return type cannot be changed by `CREATE OR REPLACE`, so 0053 drops and recreates —
      and privileges do not survive a drop, which is the trap `repo.md` records: forget the
      REVOKE and GRANT and the function looks healthy while `idenzy_app` loses its only
      membership lookup, so every dashboard request answers as though the caller were in no
      organisation at all. `tenancy.integration.test.ts` reaches the function as the app
      role, which is what proves the grant came back.
      Two decisions worth keeping. The stamp is written **after** the role check, never
      before: a request about to be refused has not shown the seat to be in use, and
      stamping it would make a caller who may do nothing here look, on the one screen that
      reports exactly this, like one who did something. And the window is a rolling
      twenty-four hours rather than a calendar day, because a calendar boundary makes the
      write rate depend on a timezone nobody chose — a member working either side of local
      midnight would be stamped twice within an hour. A failed stamp is swallowed and
      logged: this is bookkeeping about a request rather than part of answering it, and a
      control-plane write that could turn a readable dashboard into a 500 is the wrong
      trade for a relative timestamp. `OrgSummaryRow` stopped extending `Membership` in the
      same change, because the switcher has no use for the column and inheriting it would
      have meant `orgs_for_user` returning one nothing reads
- [~] Cloud Armor rules and application rate limits. **The application half is in and the
      edge half is not**, which is the right order: a WAF rate-limits an address against a
      path, and the thing worth limiting here is an account being named by a thousand
      addresses. Before this, `RateLimitStrategy` had been provided in `auth-api` since phase
      0 with exactly one caller — `SmsFraudGuard` — so password sign-in, OTP start, magic
      links, OAuth starts, the passkey ceremonies and anonymous sign-up had no throttle at
      all, against 4.5 and 4.9. `@RateLimit` is opt-in like `@RequireSession`, and
      `RateLimitGuard` sits between tenant resolution and the session guard on purpose: after
      the project is known, so a bucket is scoped to the project it is spent against and two
      customers behind one corporate NAT do not share one, and before the session lookup, so a
      flood is refused at its cheapest point. Both dimensions fail **open** through `check`
      rather than `checkStrictly`, the opposite of what `SmsFraudGuard` does with the same
      strategy, because a sign-in we could not count is a sign-in and an SMS we could not
      count is a bill. The subject key is hashed, since otherwise the key space is a list of
      the addresses of everyone who has tried to sign in.
      **Two findings worth keeping.** The address it all keys on was forgeable:
      `trustProxy: true` makes `request.ip` the *leftmost* `X-Forwarded-For` entry, the one
      the caller wrote, so any attacker had as many buckets as they cared to invent.
      `ClientIpResolver` counts from the right instead and `TRUSTED_PROXY_HOPS` says how far,
      defaulting to 0 — trust nothing, use the socket address. And the first set of ceilings
      would have broken real customers: an address is not a person, a whole office arrives
      behind one NAT, and email OTP is the *default* way in, so a per-address ceiling tight
      enough to ration normal use takes a customer's staff offline at nine in the morning.
      Address ceilings now catch what is plainly abnormal and nothing finer; the subject
      ceiling is the strict one, and it is the one an attacker cannot spread out of. The
      per-subject limit is a soft lockout and 4.5 refuses lockout — the distinction, written
      down in `limits.ts` rather than assumed, is that these expire on their own in minutes,
      need no unlock and touch no state on the account. `rate-limit-coverage.test.ts` reflects
      over every controller and fails when an unauthenticated route carries no spec, which is
      the test whose absence was the whole bug; its exemption list is empty and a stale entry
      fails too. Refresh is deliberately **not** limited: it is 150 calls per MAU per month by
      design, reuse detection already revokes a replayed family (ADR-0007), and a ceiling
      guessed without traffic data would be a sign-in outage for the first large customer
- [x] The discovery document advertised three endpoints that do not exist.
      `authorization_endpoint`, `token_endpoint` and `userinfo_endpoint` pointed at
      `/oauth/authorize`, `/oauth/token` and `/userinfo`, and none of the three is a route —
      so a client that believed 4.2's "standards-compliant OIDC provider" was redirected into
      a 404 after we had already sent a user through it. What we serve is the JWKS half, which
      is what a verifier reads and what makes that claim true, so the authorization-server
      half is omitted rather than filled in: the same client now fails at discovery, early
      enough to read. The fields are optional in the schema rather than deleted, because we
      would serve them if we ever became an authorization server. The test asserts the
      property rather than the shape — every URL the document names resolves to something
      that is not a 404 — since the old document parsed perfectly well

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
      left was the dashboard screen, and it is wired now: `GET/PUT
      .../claim-template` on the management API, developer to read and admin to write,
      because a claim is what a customer's own authorisation code branches on. A PUT and
      not a PATCH — a template is an ordered list and the screen edits the whole of it, so
      a patch over one would need a language for naming positions. The four rules are
      restated in the management service rather than shared with the auth API's, because
      the two do not share a process; keeping them in step matters more than the repetition,
      since a template the dashboard accepts and the issuer refuses is a project whose
      tokens stop being minted, discovered at somebody's next sign-in.
      Three bugs, all found by calling the route rather than reading it. Two refusals came
      back as 500s because the helper threw a raw `ZodError`, which is the exact trap the
      auth API's own service documents — they are `ValidationFailedError` now and say which
      claim was wrong. And the acknowledgement was echoed from the request rather than
      derived from what was stored, so removing the last private-metadata claim left the
      screen showing a consent the record did not hold
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
      idempotent when it lands.
      **Money in is done.** A Stripe adapter behind a `PaymentProvider` port, a hosted
      checkout, cards on file, the automatic rule's settings, the webhook receiver, and all
      four panel screens off their fixtures. The SDK rather than the REST API, which
      reverses the call SES and Cloud Tasks got: those are one signed request, this is five
      object families plus signature verification, where `constructEvent` owns the tolerance
      window and the constant-time compare and a careful implementation of ours would be a
      liability. No card number reaches this system — adding credit answers with a URL to
      leave for, which is what keeps every service out of PCI scope. Three guards stand
      between a delivery and a second lot of credit and all three are in the database: a
      unique index on the provider's event id, a unique index on the intent id, and
      `settled_at is null` inside the update that settles; granting and settling are one
      transaction. The organisation comes off the event rather than a lookup — stamped on
      the session, the intent and the setup intent, read only after the signature verifies.
      A deployment with no keys is correct and answers `provider: null`; a *partial* one is
      a boot failure, because missing only the webhook secret means a checkout we cannot
      verify the outcome of.
      **Four bugs that only running it could find**, which is the argument for doing so.
      A `mode: setup` session is refused without a `currency` even though it charges
      nothing. A content-type parser of ours collides with the one Nest's adapter
      registers — `FST_ERR_CTP_ALREADY_PRESENT`, a boot crash — so the raw body comes from
      Nest's own `rawBody` option instead. A constructor parameter typed
      `PaymentProvider | null` emits `Object` into `design:paramtypes`, so Nest resolved
      nothing and the parameter arrived `undefined`: `=== null` was false and the next line
      dereferenced it, which is the same shape as the `useImportType` trap and surfaced as a
      webhook answering 500 to a signature that verified perfectly. And a forged signature
      was a 500 rather than a 400, which would have had Stripe redelivering for days over a
      body that will never verify.
      **Money out is done too, and it is a drawdown rather than an invoice run.** The model
      is prepaid: an organisation buys credit and spends it, so there is no month-end bill
      and `invoices` stays empty until an enterprise customer wants terms — the table is
      already shaped for that and nothing about it changes.
      `UsageDrawdown` in `apps/workers` reprices each organisation's month every five
      minutes and charges the difference from what it has already charged (ADR-0014). Never
      the price of a delta: the bands are marginal, so pricing 40,000 users on their own has
      to guess which band they fall in and gets it wrong at every boundary — and the
      boundary is where customers actually are. Repricing the total means every band is
      settled inside one pure function and none of it is in the job, which is also what
      makes changing the table later a data change.
      That one property gives three others for free. MAU within a month only grows, so the
      watermark only moves forward and the difference is never negative; a pass that runs
      twice computes zero; and two passes at once are settled by a compare-and-swap on the
      watermark rather than a lock, the same shape the SMS spend cap already uses. Taking
      the credit, moving the debt, writing the record and advancing the watermark are one
      transaction — any split is a way to charge twice or to charge and forget.
      **The free tier and the bands are the organisation's now, not each project's**, which
      revises 5.1: "free on every project" was bought by splitting one project into ten.
      Organisation MAU is the sum of its projects' months, and that sum is exact because
      users are project-scoped and two projects' sets are disjoint — the opposite of summing
      a project's own days, where the same person recurs and only a union is honest.
      **Credit and debt are separate**, because `credit_grants.remaining_cents` is
      non-negative and should stay so: a grant is something that was bought. What a
      drawdown cannot cover lands on `org_debts`, a top-up settles it before becoming
      spendable, and `usage_charges` is the append-only record beneath both — SELECT and
      INSERT only, because a ledger somebody could amend is not evidence of anything.
      **Running out is not a cliff.** An organisation may owe up to a tolerance — 20% of
      what it was charged in the last thirty days, floored at $50 — before the metered
      channels refuse. Charges and not top-ups: tolerance keyed on payments moves when a
      customer happens to pay, so one that prepays in January would have rope until the 31st
      and none on the 1st having done nothing differently. `WalletSolvency` is the gate and
      it sits on the SMS path only, in front of the spend cap. Authentication, the
      dashboard, the API and mail on the shared domain never stop, whatever is owed.
      **No queue, deliberately.** The meter flushes on `USAGE_FLUSH_INTERVAL_SECONDS`, so
      repricing more often than the flush reads the same numbers again; the watermark makes
      replays free, which is the one property at-least-once delivery would have bought; and
      what is left is a handful of indexed reads per organisation per pass. Same cost
      argument ADR-0012 made against putting every webhook delivery through Cloud Tasks.
      Two bugs worth keeping. `orgScope()` names the repository's own table, so reaching for
      it while selecting from `usage_charges` emitted `"usage_billing_state"."org_id"`
      against a table not in the query — the same mistake the project users read model made
      with `tenantScope()`, and the reason the second line of defence has to name what it
      filters. And the first concurrency test passed with the compare-and-swap deleted:
      two passes through `Promise.all` are serialised by the pool, so the second read a
      watermark the first had already moved and charged nothing for the ordinary reason
      rather than the interesting one. It interleaves two transactions by hand now, and it
      fails when the `setWhere` goes.
      Email and SMS rates are declared in the price list and marked as placeholders: 5.1
      quotes them and neither has been checked against a vendor bill. Only MAU is charged
      today
- [ ] Close what `risks.md` lists as open, in the order it gives. **Email has no ceiling of
      any kind** — `assertWithinQuota` allows everything and says so — which is a shared
      sending-domain reputation problem before it is a cost one: one project's blast puts
      every other free-tier customer's verification mail in spam. **Authentication is to
      become stoppable**, reversing `ZERO_KEEPS_WORKING`, because an organisation at 500k
      MAU that never pays costs roughly $400 a month in infrastructure alone on top of the
      unbilled revenue, for as long as it likes. It must not ship before the three
      safeguards in section 7 exist, and none does: nothing notifies a customer before
      anything stops (`spend_alert` has settings, a threshold, an idempotency column and no
      caller), there is no manual hold a person can set without a deploy, and there is no
      suspension state to set in the first place. Also open: nothing reconciles a Stripe
      webhook that never arrived, so a `top_ups` row can sit pending forever with the
      customer's card already charged
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

- [x] Decide what stays in `usage_daily` and what moves. **Decided, and the billing half is
      built.** The rollup stays, for the reason above and one the sizing made sharper: it is
      the bytes rather than the rows that do not fit. A project past about four thousand daily
      actives pins its sketch dense at 16 KiB a day, which is 35 MB over the six years
      `Retention.Years6` asks for, on a primary that is also serving sign-in and in every
      backup of it. So the sketch now lives exactly as long as the period it bills:
      `usage_periods` records the month, `mau` and `mau_to_date` freeze what the chart needs as
      two integers, and the closer in `apps/workers` drops the sketches in the same transaction.
      Seventy-two rows of integers per project instead of two thousand rows of sketches, and
      what an invoice rests on stays beside the ledger it must agree with. Three tiers now, each
      with its own term and a sweeper that enforces it: six months of hours, two years of days,
      six years of periods. `usage_hourly` is the finest and stores a level rather than a sketch,
      which is what makes an hourly view affordable on Postgres at all — so the screen's 1d range
      is served from here and not deferred. **What still moves is everything the reader explores
      beyond those windows**: the breakdowns, the trends, the year-on-year questions, anything that
      wants a dimension `usage_*` does not carry, and anything whose answer is a scan rather than a
      lookup. The rule is the same as it was — what is billed stays, what is explored moves — and
      what changed is that the billed half now bounds itself instead of growing forever.
- [x] Ingestion. **Built, and on a Valkey stream rather than the Pub/Sub fan-out this line
      originally assumed.** The constraint that decided it is ClickHouse's and not ours: every
      INSERT creates a part, merges run behind, and a writer that outruns them is refused with
      `TOO_MANY_PARTS` — so the naive path does not degrade under load, it stops accepting writes.
      What ingestion has to be, therefore, is a batcher, and a stream with a consumer group is
      that with at-least-once attached. `LPOP` would have handed a batch over and forgotten it;
      an entry here stays pending until it is acknowledged and `XAUTOCLAIM` is how the next worker
      picks up what a dead one was carrying. The insert happens before the acknowledgement, so a
      crash between them replays rather than drops — ClickHouse has no unique constraint to
      violate, so a replay is a duplicated row in a chart, which is the cheaper failure by a
      distance. Retry is the pass interval rather than a sleep, because a store that is down is
      not helped by a worker spinning; the dead letter exists for the other failure, the one that
      never resolves, where a row ClickHouse will never accept would otherwise fail its batch
      forever and block every healthy row behind it. Enqueuing never throws and the stream is
      capped with `MAXLEN ~`: nothing on a request path may fail because a chart will be missing
      a point, and a worker that is down must not exhaust a cache that also serves rate limits and
      the revocation set. It is still **one** pipeline, which is what the line asked for — the
      transport is Valkey rather than Pub/Sub, and Pub/Sub remains right for §3.1's logging fan-out
      if that lands on a different shape. `AnalyticsRecorder` is the port with two real
      implementations, and the null one matters: a cell with no ClickHouse configured serves
      sign-ins and draws no charts rather than failing. Both producers fire after their
      transaction commits — `SessionService.issueSession`, where every flow ends, and
      `RefreshService.rotate`, which records refusals too because reuse detection is the one worth
      charting. `apps/workers` migrates the schema at boot and drains with a consumer name per
      process. Verified live as well as in tests: four events queued, drained as batches, read
      back scoped per project, and the reading identity refused a write. **BullMQ was considered
      and rejected**: it is a job queue, one job is one unit of work, so it would have produced
      either an INSERT per event or a hand-rolled batcher on top of it — grouped batching is a
      paid feature — and it would have brought ioredis into a tree that already ships iovalkey
- [x] Tenant isolation with no RLS to lean on. **ADR-0013**, and it is two lines again: a client
      with no unscoped method, and a row policy keyed on a custom setting the client supplies per
      request — which is what `set_config(..., true)` buys in Postgres and what a connection-level
      `SET` would have thrown away on the first pool reuse. The default is the nil uuid rather than
      unset, so a forgotten scope reads nothing instead of throwing something that looks like an
      outage. **The finding worth having is on the write side**: a ClickHouse row policy filters
      reads and, unlike a Postgres `WITH CHECK`, does not constrain writes at all — verified by
      inserting a row for project B from a client scoped to A and watching B read it back. So the
      identities are split by verb: the reader holds SELECT and no INSERT, the pipeline holds
      INSERT and no SELECT, and what binds a row to its tenant is the producer rather than the
      database. Stated in the ADR rather than glossed: the store's isolation is a read-side
      guarantee.
- [ ] Residency: a cell is an independent stack (§4.13.5), so an EU project's events go to
      the EU cell's ClickHouse and a cross-cell query is not a thing that exists.
- [x] Column classification. **The registry rather than a second generator.**
      `classifiedAnalyticsTable` registers into the same map `classifiedTable` does, under an
      `analytics.` prefix so a ClickHouse table cannot collide with a Postgres one and a reader of
      the data map can tell which store an answer came from; `tools/compliance-cli` imports both
      schemas. `analytics.auth_events` is in the generated data map and RoPA now, with `ip` and
      `user_agent` as pii. The brand moved from the builder to the descriptor — there is no builder
      here — so `column()` is the only thing that can make one and it takes a classification as an
      argument: an unclassified analytics column is a value that cannot be constructed. Three
      refusals at module load: a column whose retention differs from its table's, because ClickHouse
      drops rows and a data map claiming otherwise describes something the engine cannot do; a
      retention with no interval to express it; and a TTL measured from a column the table lacks.
- [~] Erasure and retention. **Retention is done and erasure is not.** Every table carries
      `TTL … + INTERVAL` with `ttl_only_drop_parts`, so ageing out drops whole monthly partitions
      rather than rewriting the table on a schedule — the same reasoning partition-dropping has for
      `audit_events` — and the interval is derived from the same `classified()` declaration the data
      map is generated from, so the two cannot disagree. What is owed is the delete path: the
      columns say `row_deleted` because a row keyed on a user with the user removed is not anonymous
      (the timing alone re-identifies), and nothing yet lets the DSR handler call it. Until it does,
      the erasure promise is true of Postgres and not of this store, which is the honest statement
- [ ] Panel wiring, last. `apps/client`'s stores are placeholders behind real screens, so
      the swap is a client change rather than a screen change — which is the point of
      having built them against a store rather than against a query.

---

## Phase 4: B2B (12 weeks)

- [~] Organizations, memberships, roles and permissions. `org_members` and
      `org_security_settings` are in, with the four roles in `@idenzy/protocol` and the
      one-owner rule held by a partial unique index rather than by application code. The
      permission matrix itself is still the panel's, but the management API enforces the
      ladder now: `/v1/orgs/:orgId/members` reads at viewer, writes at admin and transfers
      ownership at owner, with the owner protected from demotion and removal in the service
      rather than at the index. What is not enforced is the dashboard's own MFA requirement:
      `org_security_settings.require_mfa` is stored and read back, and nothing on our sign-in
      path consults it, which the screen states
- [~] Invitations. `org_invitations` and its repository are in, including the
      `resolve_open_invitation` function a link has to go through because the person
      following it is not in the organisation yet. Creating, resending and revoking one are
      management API calls now, and the token is hashed before it reaches the database so a
      backup is not a set of live invitations. **Nothing sends the email**, and both the
      controller and the invite dialog say so. Accepting one has no route either: the person
      following the link is not a member yet, so it cannot sit under `/v1/orgs/:orgId`
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
- [x] Retention jobs actually enforcing `retention_policies`. `RetentionSweeper` runs hourly in
      `apps/workers` over four subjects — ended sessions, one-time code challenges, OAuth flows
      and deleted accounts — through the SECURITY DEFINER functions in 0052. A sweeper serves
      every project and binds no `app.project_id`, so under FORCE RLS a direct delete matches
      nothing: no error, no rows, and tables that grow forever while the job reports success.
      **The age is resolved per project inside the statement**, which is the decision that
      matters: `retention_policies` holds an override and nothing else, so a project that has
      never opened the settings screen — most of them — is swept at the default rather than
      skipped. A sweeper that read the policy table and looped would have missed exactly those.
      Deleted accounts are stripped rather than removed, because the audit trail points at the
      id and an erasure that broke the chain would read as tampering; the column list in that
      SQL is asserted against `classified()`'s own erasure map by a test, so a column added to
      `users` next year fails the build instead of being quietly left in every tombstone.
      Audit is not in it: `audit_events` ages out by dropping a monthly partition, which is a
      different mechanism and is the tier's promise rather than an operator's preference
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
- [ ] Open decisions 1 to 9 in §16, to be closed before Phase 0 ends. Number 2, the launch
      region, is closed: `us-central1`, and `infra/terraform/environments/dev` is the `us-1`
      cell accordingly.
