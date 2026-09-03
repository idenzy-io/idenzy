# Working in this repository

Read [PROJECT.md](./PROJECT.md) before making architectural decisions. Section 7 is
binding, not advisory: a change that violates it does not get merged regardless of how
well it works.

## The two rules that surprise people

**We ship no authentication UI.** No hosted pages, no components, no widgets, no
iframes. The auth API returns JSON and HTTP redirects, and an endpoint returning
`text/html` is a bug with a test asserting against it. If a task seems to need a sign-in
screen, the answer is an SDK primitive plus a docs example the customer owns. See
PROJECT.md 1.1 and `docs/adr/0002-no-authentication-ui.md`.

**Every database column is declared through `classified()`.** It is not a convention:
`classifiedTable` accepts only branded builders, so an unclassified column fails to
compile. Those declarations generate the RoPA, the data map, the log allowlist and the
data-subject field lists, so a column that escapes them escapes all four. See
PROJECT.md 4.13.2.

## Commands

```bash
pnpm install && pnpm run prepare   # prepare installs git hooks; ignoreScripts is on
docker compose up -d && pnpm db:migrate
pnpm dev                           # every app through turbo

pnpm turbo run typecheck build test
pnpm lint                          # biome, a root script and not a turbo task
pnpm turbo run test:integration    # Testcontainers, needs Docker
pnpm compliance:generate           # after any schema change; CI fails if stale
```

## Things that will bite you

- **pnpm settings live in `pnpm-workspace.yaml`, not `.npmrc`.** pnpm 11 does not read
  the project `.npmrc` for `ignoreScripts`, `nodeLinker` and friends. Writing them there
  looks right and silently does nothing. Verify with `pnpm config list`.
- **`pnpm run prepare` is manual after a clone**, because `ignoreScripts: true` stops
  husky installing itself.
- **Roles are not created by migrations.** `idenzy_app` and `idenzy_owner` are
  cluster-level objects created by provisioning (`infra/docker/postgres-init` locally,
  Terraform on Cloud SQL). Migration 0000 references `idenzy_app` in its `CREATE POLICY`
  statements, so a migration that also created the role could not run on a fresh cluster.
- **TypeScript is pinned to 6.0.x**, not 7. `@nestjs/cli` 12 depends on `typescript
  ~6.0.2` and Nest DI needs `emitDecoratorMetadata`.
- **App tests import from `dist`.** Vitest 4 transforms with Rolldown, which does not
  apply the legacy decorator semantics NestJS needs, so decorated classes fail to parse
  from source. Compiling first also means tests exercise the artifact that ships.
- **`drizzle-kit` does not generate roles, grants, `FORCE ROW LEVEL SECURITY` or
  partitioning.** Those are hand-authored migrations made with `pnpm db:custom`, in the
  same numbered sequence. Read them as SQL.
- **A new tenant table needs its own FORCE RLS and grant migration.** Migration 0001
  applied both by looping over the tables that existed when it ran, and it ran once. A
  table added later gets its policy from `drizzle-kit` and neither FORCE nor a grant,
  which means `idenzy_app` cannot read it at all and the owner can read across tenants.
  Copy the two `DO` blocks from `0004_nasty_catseye.sql`; they are dynamic and
  idempotent. Two tests in `packages/testing` fail if you forget.
- **`useLiteralKeys` is off** because it contradicts `noPropertyAccessFromIndexSignature`,
  which requires `process.env["X"]`. TypeScript wins.
- **Biome's `useImportType` breaks NestJS DI.** Rewriting an injected dependency to
  `import type` compiles and lints, then resolves to `undefined` in `design:paramtypes`
  and fails at boot. The rule is off for `apps/*/src/**`, and `apps/auth-api/test/
  wiring.test.ts` compiles the composition root so the failure shows up in a test run
  rather than on a container that will not start. Biome also cannot parse `@Body()` and
  friends without `javascript.parser.unsafeParameterDecoratorsEnabled`; without it its
  analysis of every controller is wrong rather than merely absent.
- **Drizzle wraps driver errors.** A constraint violation arrives as `DrizzleQueryError`
  with the pg error, and the SQLSTATE, on `cause`. Reading `code` off the caught value
  finds nothing, which is how every unique violation was surfacing as a 500 instead of a
  409. `BaseRepository.guard` walks the cause chain.
- **`.enableRLS()` changes the table's type** to `Omit<PgTableWithColumns<T>,
  "enableRLS">`, so a generic constrained to `PgTableWithColumns` rejects every table in
  our schema. `BaseRepository` is constrained to `PgTable`.
- **`drizzle-kit generate` needs a TTY when a column is dropped and another added.** It
  asks whether the pair is a rename, and there is no flag to answer. Piping input fails
  outright. Split the change into an additive migration and a drop, which is why
  `code_verifier_hash` took migrations 0007 and 0008 to become `code_verifier_encrypted`.
- **`exactOptionalPropertyTypes` means you cannot pass `undefined` for an optional
  property.** `{ transports: maybeUndefined }` does not satisfy `transports?: string[]`,
  which bites hardest when handing our own parsed types to a third-party function.
  Conditionally spread the key instead of conditionally setting the value:
  `...(x === undefined ? {} : { transports: x })`.
- **`CREATE OR REPLACE FUNCTION` cannot change a return type.** Adding an output column to
  `resolve_project_by_host` or `resolve_project_by_key_hash` means `DROP` then `CREATE`, and
  privileges do **not** survive the drop, so the `REVOKE ... FROM PUBLIC` and `GRANT EXECUTE
  ... TO idenzy_app` from migration 0002 must be repeated in the same migration. Forgetting
  them fails in one way only: the function looks healthy, `idenzy_app` loses its only
  Host-to-project lookup, and every request answers `unknown_project`.
- **Throwing inside `uow.run` rolls back what the transaction already did.** That is usually
  what you want and twice now it was not: reuse detection has to survive the error it raises,
  and a failed PKCE check has to leave the exchange code spent. Both compute an outcome inside
  the transaction and throw after it commits. If a check's whole point is that something stays
  consumed, it belongs outside.
- **argon2 encodes its parameters as `m,p,t`, not `m,t,p`.** `needsRehash` used to
  prefix-match the wrong order, so it never recognised a hash it had just produced and
  every sign-in rehashed the password again. Parse the PHC string; do not match it.

## Adding a database column

1. Declare it with `classified()` inside a `classifiedTable`. The compiler enforces this.
2. `pnpm db:generate`, then read the generated SQL before committing it.
3. `pnpm compliance:generate` and commit the regenerated artifacts.
4. If it is a tenant table, confirm it carries `projectId` and a tenant isolation policy.
5. If it is a *new* table, add the FORCE RLS and grant blocks in a `pnpm db:custom`
   migration. See the note above; the policy alone is not enough.

## Adding an error

Add the code to `@idenzy/protocol/errors/codes`, then a subclass of the right status
class in `@idenzy/core/errors`. `throw new Error(...)` is a lint error. Codes are
a public API promise: customers build every user-facing message from them, so renaming
one is a breaking change.

## Working on the browser-facing edge

Five rules, each of which is load-bearing somewhere it is not obvious.

- **Tenant resolution is first-present-wins, not a fallback chain.** Header, then
  `Authorization`, then `Host`. A header that is present but unresolvable is a hard failure;
  falling through to `Host` would let a request that named project A execute against whatever
  project the Host maps to, and nobody would notice.
- **The publishable-key header takes `pk_` only**, refused on the prefix before any lookup, so
  a real secret key and a fabricated one cost the same work and give the same answer.
- **CORS is enforced on the actual response, not the preflight.** A preflight cannot see the
  key header, so it can only be strict where `Host` names a project. An unregistered origin
  gets a normal answer with no `Access-Control-Allow-Origin`, never a 403: the refusal is the
  browser's, and a hard status would tell a prober the difference between "checked and
  refused" and "never configured".
- **Cookie mode needs a custom auth domain, and `SameSite` is why.** It is a *site* rule, so
  `app.customer.com` to `auth.customer.com` works and `app.customer.com` to the shared API host
  never will. Cookie mode is refused where it cannot work rather than granted and dropped,
  because a cookie the browser discards looks exactly like a sign-in that does nothing.
- **A route a browser *navigates* to cannot name its project.** A top-level navigation carries
  neither our header nor `Authorization`, so it resolves by `Host` alone and works only behind a
  custom auth domain. Anything a browser has to start on the shared host needs a JSON twin it
  can call and navigate itself, which is what `POST v1/auth/oauth/:provider/start` is for. The
  twin is also stricter: not being `@BrowserNavigation()`, it keeps the cross-site checks.

The cross-site checks run **before the credential is stashed on the request**. A forged request
that consumed the victim's refresh token would trip reuse detection, which revokes the whole
family: without that ordering, an attacker could sign someone out of every device by making
their browser send one request. Four routes are exempt via `@BrowserNavigation()` because
Apple form-posts its callback with its own `Origin`; they are defended by a one-shot `state`
and a single-use code instead.

## Working on `@idenzy/js`

The client half of the edge above. It may import `protocol` and `core` and nothing else, which
Biome enforces per path, and its `tsconfig` sets `types: []` with the DOM lib so a Node global
is a compile error rather than a runtime one in somebody's browser.

- **A custom auth domain is an API host, never a page.** `auth.customer.com` is a CNAME at our
  load balancer that a customer's own React page sends `fetch` calls to. Nobody navigates to it,
  it serves no HTML, and the customer's sign-in page stays wherever they put it. Say it that way
  when it comes up: "you need an auth domain" reads as "we host your sign-in screen", which is
  the one thing this product does not do (ADR-0002).
- **The transport is negotiated, not configured.** `auto` asks for cookie mode, and steps down
  to header mode once if the server answers `session_transport_unavailable`. A client cannot
  tell from its own URL whether it is on a custom domain, and only the server knows whether one
  is verified. Naming a mode explicitly turns the negotiation off in both directions: an
  explicit cookie mode that quietly became header mode is a customer believing their tokens are
  `HttpOnly` when they are not.
- **A flow that ends in a session extends `SessionFlow` and finishes through `establish`.**
  Posting the credentials and returning the body looks like it worked: the customer gets a user
  object, their form navigates, and the client is still signed out. Nobody finds that until a
  later screen asks for a token.
- **Refresh is single-flight per tab and locked across tabs, and neither half is optional.**
  The promise covers components sharing a tab; `navigator.locks` covers tabs sharing a cookie,
  which is the case a promise cannot see. Two rotations of one token revoke the family
  (ADR-0007). Never add a retry: a refresh whose response was not observed is an unknown state,
  and re-sending converts it into a certain logout.
- **Renewal is lazy, never timed.** A background timer keeps a session alive in a tab nobody is
  looking at, which turns an idle timeout into no timeout at all.
- **The refresh token is not on `Session`, and web storage is opt-in only** (ADR-0008). `Session`
  is the object handed to customer code, logged and serialised; the credential that mints tokens
  for the life of the session stays out of it. `LocalStorageRefreshTokenStore` exists and is
  never selected for anybody: a customer on the shared API host passes it themselves. The PKCE
  verifier in `sessionStorage` is a different case and the ADR says why it does not generalise.
- **The device name is the client's to give, and travels only on `establish`.** It is a
  header (`X-Idenzy-Device-Name`), percent-encoded because a header carries bytes and a name
  does not, and it is set on the one call that creates a session rather than in `headersFor`,
  where it would ride on every request that nothing reads it from. The server never derives
  one from a user agent: parsing them rots, and a wrong guess on a security screen is worse
  than a blank.
- **Responses are parsed with the protocol's schemas, never cast.** A proxy, a captive portal or
  a mistyped API URL all answer 200 with something shaped nothing like us, and a cast turns that
  into a `TypeError` inside a customer's component with nothing pointing at the cause.
- Errors are two classes and not fifty. The server subclasses per code so its filter can map a
  class to a status; a client already has the status, so a subclass per code would only be a
  second list to keep in step with `@idenzy/protocol`.
- A cancelled WebAuthn prompt keeps the browser's own `DOMException`. `NotAllowedError` and
  `InvalidStateError` are a web platform contract older than ours.
- The package is `private` until Changesets exists. Publishing is its own change.

## Working on a framework binding

There are seven of them (React, Vue, Svelte, Solid, Angular, Next, Nuxt) and they are all small,
because the part worth getting right is `SessionStore` in `@idenzy/js`. Do not
reimplement any of it per framework: each binding wraps that store in whatever its
framework calls external state, and that is all it is allowed to be. The server halves are
their own section, below, and `@idenzy/astro` and `@idenzy/remix` are only that.

Four rules the store owns, and every binding inherits.

- **The client is passed in, never built by the binding.** An `Idenzy` owns the session,
  the refresh token and the single-flight promise. Two clients on one page rotating the
  same token means the second rotation revokes the family (ADR-0007). On a server it is
  stronger than that: one client per request, never a module singleton, because a client
  shared between requests is a session shared between people.
- **`SessionSnapshot.status` has three values, not two.** `loading` is the answer until the
  first rotation comes back. A binding that collapses it into signed-out shows a sign-in
  screen to somebody who is already signed in, once per page load.
- **The store skips the first emission from `Idenzy.subscribe`.** That call reports the
  client's opening position, and a client that has not rotated says signed-out because it
  has nothing rather than because nobody is signed in. Published over a server's seed it
  turned a signed-in page into a sign-in screen the moment a component subscribed.
- **`initial` is what a server already worked out, and it carries no profile.** The access
  token names the user and the session and does not contain the user object, so a seeded
  snapshot has `userId` and a null `user`. Anything rendering a name on the first paint has
  to be given one separately.

Two of them carry something the others do not, and both are easy to undo by accident.

- **`@idenzy/solid` contains no JSX and cannot.** Solid's JSX is compiled by its own Babel
  plugin and not by `tsc`, so the only thing `tsc` could emit is a `.js` file still full of
  JSX, which a customer's bundler does not compile inside `node_modules`. The provider is
  built with `createComponent`, which is what that plugin emits anyway, and `children` stays
  behind a getter because the `Provider`'s own owner is what has to resolve them: evaluate
  them at the call site and every primitive below runs outside the context.
- **Solid's test config picks the browser build on purpose.** Node resolves `solid-js` to its
  SSR build, where `createEffect` does nothing and `createMemo` computes once, so a suite that
  took it reports a pass on a binding whose reactivity never ran. `resolve.conditions` in
  `vitest.config.ts` is what stops that, and three tests fail without it.
- **React and Solid both refuse a client swapped underneath them.** They are the two whose
  props are re-read, and in Solid the body runs once so the swap is otherwise invisible. The
  quiet version leaves every hook or primitive reporting a session nobody is calling any more.

## Working on an SSR helper

There are five (`@idenzy/next`, `@idenzy/nuxt`, `@idenzy/svelte/server`, `@idenzy/astro` and
`@idenzy/remix/server`) and they all do the same thing: verify the access token in the
`__Host-idenzy-session` cookie against a cached JWKS and hand the answer on as a seed, so a
page rendered for a signed-in user costs no round trip (PROJECT.md 4.3).

They deliberately do not share an implementation. The shared piece would need `seededSession`
from `@idenzy/js` and `AccessTokenVerifier` from `@idenzy/node`, and Biome forbids the first
inside `packages/sdk/server/**` on purpose. Fifteen lines per package, each with a docstring
saying what that framework's policy is, beats a package that exists to hold them. Revisit if
the policies converge rather than because the count grew.

Four rules every one of them keeps.

- **Null is not signed out, and never renders as signed out.** The access token is the
  short-lived half, so a visitor whose token expired an hour ago still holds a refresh cookie
  and is still signed in. Null seeds `loading` and the browser settles it. Seeding signed-out
  puts a sign-in form in the HTML for somebody who does not need one.
- **A seed never throws, an outage included.** A handle, a middleware or a root loader that
  threw is a 500 or an error boundary on every page of a customer's site for the length of a
  JWKS outage, and the site does not need us in order to render. Null renders `loading`.
  `@idenzy/next` is the only one that also exposes the claims directly, and `verify` there
  does throw on an unreadable key set, deliberately: authorisation code told "no claims" when
  the truth is "cannot tell" refuses the right people for the wrong reason. `sessionFor` and
  `session` are seeds and swallow it.
- **The verifier is built once, at module scope.** The key set is cached inside it, and one
  per request fetches the key set per request. There is a test in each package that asserts
  one fetch across two requests.
- **No route guard anywhere but Next**, where `protectRoutes` exists because middleware has
  nothing else to be. Elsewhere it is two lines a customer owns, and where an unauthenticated
  visitor lands is a product decision in any case (ADR-0002).

`protectRoutes` is the one place the three-way distinction is visible, and it is worth
understanding before touching it. A gate needs three answers where a seed needs two: signed
in, a credential read and refused, and a credential that could not be judged at all. It is
built on `verify` and not `sessionFor` for exactly that reason. The third answer is 503 with
a `Retry-After`, never a redirect: sending a signed-in visitor to a sign-in page because our
key endpoint is unreachable signs them out for the length of the outage and asks them to fix
something that is not broken on their side. `onUnverifiable: "allow"` is the explicit loose
choice, and it is defensible only because the gate was never an authorisation decision.

What differs, where the difference is not obvious:

- **Nuxt** imports its server half dynamically inside the server branch. Svelte and Remix use
  a subpath for the same purpose. Astro needs neither: middleware never reaches a client
  bundle. In Remix the subpath is load-bearing rather than tidy, because a loader lives in the
  same file as the component it feeds, so `@idenzy/remix` publishes no `.` export at all.
- **`@idenzy/astro` has no client half and will not get one.** An island is React, Vue,
  Svelte, Solid or none of them, so the browser binding is whichever one the customer chose.
- **`@idenzy/remix` memoises its answer weakly per request**, and that is correctness before
  it is cost. Remix runs a page's loaders in parallel and may run an action before them;
  verifying per call lets two of them straddle the token's `exp` and render one page from two
  answers, which is a header that says signed in above a body that does not.
- **SvelteKit's `restore: browser` is the customer's to remember.** A layout renders on the
  server too, and a restore there rotates a cookie the server does not hold: one request to
  the auth API per render, answered signed-out, for nothing. Nuxt gets this right because we
  own the plugin; in SvelteKit the layout is theirs, so `setIdenzy` says so in its docstring.
- **`@idenzy/next` sets `moduleResolution: bundler`** in its own `tsconfig`, unlike every
  other package. `next/server` and `next/headers` have no exports map and are not resolvable
  as ESM subpaths at all, and the consumer is a bundler in any case.

### Declaring a framework's types rather than depending on it

SvelteKit, Astro and Remix are all absent from the lockfile, and that is a decision rather
than an oversight. Each helper needs `request.headers` and `locals` off one object; the
packages that would supply those types are build tools, and `@sveltejs/kit` drags in `vite`
and a Svelte plugin as strict peers for it. So the shape is declared in our own source.

The part that is not obvious: **the returned function has to be generic in its event or
context.** A non-generic parameter type fails contravariantly against the framework's own
`Handle` or `MiddlewareHandler`, because the `resolve` or `next` callback takes the framework's
full event and our narrow one is not assignable to it. Each package's test transcribes the
framework type and assigns to it, so a change that breaks the shape breaks a typechecked test
here rather than a customer's build.

## Working on `@idenzy/react`

Small on purpose: a provider, three hooks, and a store that adapts one to the other. Four
things are load-bearing.

- **The client is a prop, never built in the provider.** An `Idenzy` owns the session and
  the single-flight promise, so a render that built a second one puts two clients on one
  page rotating the same refresh token, and the second rotation revokes the family
  (ADR-0007). A client swapped underneath the tree throws rather than being ignored: the
  quiet version leaves every hook reporting a session nobody is calling any more.
- **`useSession()` has a status `@idenzy/js` does not.** `loading` covers the window before
  the first rotation answers. Without it an application renders its signed-out tree for a
  frame on every load, which is a sign-in form flashed at somebody already signed in.
- **The snapshot has to be referentially stable.** `useSyncExternalStore` reads it on every
  render, so returning a fresh object is an infinite loop and not a slow component.
  `SessionStore` caches, compares field by field, and publishes only on a real change.
- **Restore runs once per store however many times the effect fires.** React 19 mounts,
  cleans up and mounts again in development. The rotation underneath is single-flight
  anyway, and the guard is what makes the second call free rather than merely survivable.

There is deliberately no `useToken()`: a token outlives neither the render it was fetched
in nor the call it was for, and renewal here is lazy on purpose.

## Working on `@idenzy/node`

The server half, and the smallest package we ship. It verifies; it never holds a session.

- **`aud` is required and the constructor refuses a project id that is not one.** One issuer
  serves every project on a deployment, so `iss` and the signing key are shared and the
  audience is the only thing separating tenants. A verifier that skipped it would accept a
  perfectly good token minted for somebody else's project, and there is a test that says so.
- **A JWKS endpoint that cannot be reached is not a bad token.** `JWKSTimeout`, `JWKSInvalid`
  and a `fetch` `TypeError` are rethrown as themselves; wrapping them in
  `AccessTokenInvalidError` would sign every user out of a customer's application for the
  length of an outage. An unknown `kid` is the opposite case: `jose` has already refetched by
  then, so the key really is not ours and the token really is invalid.
- **Verification is offline and that is a trade, not a free win.** A revoked session stays
  verifiable until its access token expires, which is why the default lifetime is short and
  why anything needing instant revocation has to consume the revocation set (PROJECT.md 4.2),
  which this package does not do yet.
- It may import `protocol` and `core` and nothing else of ours, and Biome refuses `@idenzy/js`
  here by path: a client SDK holds a session and speaks to the DOM.

## Adding an authentication flow

Extend `AuthFlow` in `@idenzy/domain` and implement `verify` only. The base owns MFA
gating, hook invocation, session creation and audit ordering, and a flow that wanted to
skip any of them would have to stop extending it, which is visible in a diff. Sign-up is
an `AuthFlow` too: establishing the subject there means creating them.

`FlowHooks` and `FlowAudit` are interfaces, so they are injected with the symbol tokens
in `apps/auth-api/src/flows/flow-tokens.ts` rather than by type.

Anything security-critical needs a test that asserts the attack fails (PROJECT.md 7.4),
not only that the happy path works. The existing ones are the models: refresh reuse
revoking the family, revoking a stranger's session answering 404, and a missing user
costing the same Argon2 work as a wrong password.

## Storing something a challenge has to read back

A one-time code, a link token and an exchange code are all hashed at rest, but they are
not hashed the same way and the difference is not stylistic. A 256-bit random token is
SHA-256, because there is nothing to sweep. A six-digit OTP is an **Argon2id hash**,
because a million candidates fall to an offline sweep the moment that table leaks.

The address a challenge belongs to cannot be hashed at all, because verification has to
name it in order to create the account behind it. Those columns are `encrypted()` under
the project's data key, and `otp_challenges` carries both: the hash for the "is there
already a live code" seek, the ciphertext for the read-back.

`auth_codes.code_challenge` is the mirror image of the OAuth verifier two paragraphs down.
There we are the *client* and must present the value, so it is encrypted. Here we are the
*server* and only ever compare, so we store the digest and never the verifier.

A WebAuthn challenge is the easy case and is SHA-256: 256 bits of random with nothing to
sweep, and the browser hands it back inside `clientDataJSON` so we only ever compare it.
The OAuth PKCE verifier is the one exception in the schema, encrypted rather than hashed,
because we are the client there and have to present the value itself.

## Touching the passkey ceremonies

Five rules, each of which is load-bearing somewhere it is not written.

- **Authentication options take no identifier and name no credential.** An endpoint that
  accepted an email would answer differently for an address with passkeys and one without,
  which is an enumeration oracle in front of the flow we promote as the default.
- **`residentKey: required` at registration is what pays for that**, and the coupling
  crosses two endpoints. Relax it and sign-in has nothing discoverable to offer, so the
  usernameless flow quietly stops working for credentials enrolled after the change.
- **The challenge is claimed before anything is verified, not after.** `claim` reads and
  consumes in one statement and returns the row. A nonce burnt only on success is one an
  attacker can keep signing against.
- **Do not re-implement the sign-counter check.** It lives inside
  `verifyAuthenticationResponse`, throws rather than returns, and fires before we would see
  the new value. What is ours is writing the counter back: a value never stored leaves a
  comparison that always passes and a replayed assertion that works forever.
- **`pubKeyCredParams` and `supportedAlgorithmIDs` are the same list**, passed explicitly
  in both directions. Advertising an algorithm the verifier rejects enrols an authenticator
  that can never sign in, and it fails on the user's next visit rather than at enrolment.

The relying party is per project and read from `webauthn_relying_parties`, never derived
from the request Host: the RP ID decides which credentials an assertion may address. One
row per project, enforced by a unique index, because a credential is bound to the RP ID it
was created under and two would split a customer's passkeys into disjoint sets.

Tests use `TestAuthenticator` from `@idenzy/testing`, which is a real software
authenticator: a real P-256 key, real CBOR, a real signature. That is deliberate. Every
attack worth testing here (replayed challenge, cloned counter, wrong origin, another
tenant's credential) is one a fake verifier would happily accept.

## Adding a provider, factor or channel

Extend the family's abstract base in `@idenzy/domain/ports` and implement only what
varies. The base owns what must never be skipped: the state check for OAuth, the
suppression check for email, the spend reservation for SMS. Do not re-implement those in
a subclass, and do not add an abstraction until there are two real implementations.

For an OAuth provider that means an endpoint pair and a profile mapping, plus running
`OAuthProviderConformanceSuite` from `@idenzy/testing`. Two rules the suite cannot check
for you. `emailVerified` must be false whenever the provider does not explicitly assert
otherwise, because that field alone decides whether an account can be linked on an
address. And the subject must be the provider's immutable id, never a username or an
address: GitHub logins can be renamed and handed to someone else.

A concrete provider needs an explicit constructor that only calls `super`. It is not
useless: it widens the abstract base's `protected` constructor to `public`, which is what
lets the registry build one. Biome flags it, so the suppression carries that reason.

## Tests are typechecked, and were not always

Every package with a `test/` directory has a `tsconfig.test.json`, and `typecheck` runs it
after the build config. Before that existed no test file in the repository was ever
typechecked, because `vitest` transpiles without checking and `tsconfig.json` includes
only `src`. A conformance suite that could not have compiled reported a pass.

## Tests that must never become optional

The RLS negative tests and the audit append-only tests in `packages/testing`. They assert
that an attack or a mistake fails, which is the only thing that proves tenant isolation
holds when application code is wrong. A test that only exercises correct usage proves
nothing here.

## Compliance claims

The architecture is built for SOC 2, ISO 27001, GDPR and HIPAA. **No certification is
held.** Nothing in this repository may be quoted to a customer as a compliance claim, and
PROJECT.md 4.13.10 lists exactly what is not being done.

## Style

Conventional Commits, machine-checked. Docstrings short and informative: say what a thing
does and why it exists, plus the non-obvious constraint if there is one. Do not restate
the signature.
