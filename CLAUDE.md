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
- **A new tenant table's grant migration is not optional even when the table is config.**
  `sms_policies` holds the spend cap, so a missing grant would not fail loudly: `idenzy_app`
  reads no policy, every project looks unconfigured, and SMS refuses everywhere.
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
- **Node has `navigator.locks`, and the refresh lock is named after the publishable key.** Two
  clients built with the same key queue behind each other, which is the whole point in a
  browser (ADR-0007) and a hang in a test file: a case that leaves a rotation unanswered holds
  the lock, and every later client for that key waits on it forever. The symptom is a binding
  that appears never to restore, with no request in the transport to explain it.
  `@idenzy/sdk-conformance` gives each client a key of its own. jsdom hides the whole problem,
  because it has no `navigator.locks` at all, so the suites that run in a browser environment
  pass either way.

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
- **A null `initial` is an answer and a missing one is not.** Null is a server saying it
  looked and could not place the visitor, which holds `loading`; absent says nobody looked,
  and with `restore: false` the store then lets the client's own position stand, which for a
  client holding nothing is signed out. So a binding hands the seed on exactly as it arrives,
  null included. Dropping the key on null is what put the signed-out tree in the HTML of every
  Nuxt page in the module's default configuration, and in SvelteKit's documented call.

Those rules are checked rather than promised. `BindingConformanceSuite` in
`@idenzy/sdk-conformance` runs ten cases through an adapter the binding provides, and React,
Vue, Svelte, Angular and Solid each run it in a single test. Next and Nuxt inherit it, because
their browser halves are `@idenzy/react` re-exported and the Vue plugin. Write the adapter over
the binding's own provider and its own session primitive: one that reached past them into
`SessionStore` would pass every case while the thing a customer imports stayed broken. The
package's own tests run the suite against a reference binding and four deliberately broken
ones, because a suite that cannot fail proves nothing.

It deliberately does not extend `ConformanceSuite` from `@idenzy/testing`, where the other
family suites live. That package carries Postgres, Testcontainers and the domain layer behind
it, and `pnpm test` for `@idenzy/react` must not pull the server stack into its build graph.
What they would have shared is the loop.

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
  puts a sign-in form in the HTML for somebody who does not need one. The null has to reach
  the binding to do that, so hand it over rather than dropping the key: see the `initial` rule
  above for what a missing seed means instead.
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
- **A revocation set is passed in, never built**, for the same reason the browser client is:
  it holds a secret key and a polling timer, and its `start` and `close` belong to whoever
  owns the process. Attaching one is what closes the gap between a revocation and the access
  token's expiry, and a helper without one verifies exactly as it did before. Nuxt is the
  exception and the section below says why.

`protectRoutes` is the one place the three-way distinction is visible, and it is worth
understanding before touching it. A gate needs three answers where a seed needs two: signed
in, a credential read and refused, and a credential that could not be judged at all. It is
built on `verify` and not `sessionFor` for exactly that reason. The third answer is 503 with
a `Retry-After`, never a redirect: sending a signed-in visitor to a sign-in page because our
key endpoint is unreachable signs them out for the length of the outage and asks them to fix
something that is not broken on their side. `onUnverifiable: "allow"` is the explicit loose
choice, and it is defensible only because the gate was never an authorisation decision.

Which is why **a revoked session is a credential problem and not an outage**, and the list in
`isCredentialProblem` is where that is decided. It sits with a missing token and an expired
one, so `verify` answers null and the gate redirects. Let it out as a throw instead and it
arrives as "cannot tell": 503 to somebody who should be signing in again, and under
`onUnverifiable: "allow"` the revoked session waved straight through, so the one case the set
exists to catch becomes the one case the gate stops catching. Three tests fail if it moves.

What differs, where the difference is not obvious:

- **Nuxt** imports its server half dynamically inside the server branch. Svelte and Remix use
  a subpath for the same purpose. Astro needs neither: middleware never reaches a client
  bundle. In Remix the subpath is load-bearing rather than tidy, because a loader lives in the
  same file as the component it feeds, so `@idenzy/remix` publishes no `.` export at all.
- **Nuxt builds its own revocation set, because its options are serialised.** A module option
  goes into the build, so there is nowhere for a customer to hand over a live object. It takes
  a secret key instead, and that key is the only thing in this module that is not public by
  construction: it goes to `runtimeConfig`, never `runtimeConfig.public`, under its own
  `server` interface rather than an optional field beside the publishable key. `setup` peels
  it off by name before either half is written, because a deny list gets a new secret added to
  it one release late. `secretKey` defaults to `""` so `NUXT_IDENZY_SECRET_KEY` has a key to
  override; Nuxt discards an env var whose key is absent from runtime config, and the symptom
  is a set that polls and finds nothing rather than an error. `start` is deliberately not
  awaited: it fetches before it schedules, and awaiting it on the first render turns a hung
  connection into a page that never answers. Until it lands the cache reads stale and answers
  "not revoked", which is the documented fail-open.
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
  verifiable until its access token expires, which is why the default lifetime is short.
  `RevocationCache` closes most of that gap without giving the property up: it polls the
  published set and answers from memory, so a check costs a hash lookup and no I/O. It is
  opt-in, it needs the project's secret key, and it fails open when it cannot reach us. See
  the revocation section below before changing any of that.
- It may import `protocol` and `core` and nothing else of ours, and Biome refuses `@idenzy/js`
  here by path: a client SDK holds a session and speaks to the DOM.

## Working on the revocation set

The thing that lets a five-minute access token behave like a sixty-second one without a
refresh storm (PROJECT.md 4.2, ADR-0009). Read the ADR first: three of these are decisions
that look arbitrary until you know what they are avoiding.

- **It is published, never queried.** A customer's verifier is offline on purpose, so it polls
  a snapshot and checks an in-process copy. A lookup on their request path would put our
  latency and our availability inside their request, which is the property offline
  verification exists to sell. Our own API does not read the set at all: `SessionGuard` reads
  the session row, so revocation is already immediate there.
- **Everything that verifies offline can hold one, and nothing has to.** `@idenzy/node` takes
  a `RevocationCache` on its verifier, and the five SSR helpers pass one through to the same
  place. It stays opt-in in every one of them: a customer who builds none keeps a package
  whose only outbound call is for the key set. What changes when one is attached is the
  answer, not the shape of it, so see the SSR helper section for where a revoked session has
  to land in a gate.
- **Publish after the commit, never inside it.** The failure directions are not symmetric. A
  missed revocation degrades to the token expiring, which is where we were before the set
  existed. A false one is unrecoverable: the set is keyed by session id, refreshing mints a
  new access token for the same session, so nothing the client does clears the entry. Reuse
  detection is the sharp case, because it revokes and then throws; there is a test that fails
  when the publish moves after the throw.
- **`RevocationPublisher` never throws.** The revocation has already happened and the outbox
  event is already written in the same transaction, so failing the call would report an error
  for work that succeeded. The outbox is the durable path; the direct write is the fast one.
- **A bulk revoke publishes a watermark, not a list.** Signing out everywhere and a password
  reset end every session a user holds, and one entry per session does not bound. The
  watermark is compared strictly against `iat` and floored to the second, so a token minted in
  the revocation's own second survives it: `iat` is second-accurate, and under-revoking by
  under a second beats revoking a token issued after the event.
- **The endpoint takes a secret key.** PROJECT.md 4.2 sketched it as cacheable, which reads as
  public, and it cannot be: the payload names users and times their security events, and a
  project id is the `aud` of every token we sign, so it reaches every browser. The ETag is
  what keeps polling cheap instead of a CDN.
- **One key signs both kinds of statement.** A snapshot carries a `typ` that is not `JWT`,
  both access-token verifiers require `JWT`, and `TokenIssuer.issueStatement` refuses to put
  `sub` or `sid` in a statement at all. Any one of those alone would be a single point of
  failure for token confusion (RFC 8725 section 3.11).
- **The reconciler is why a failed write is survivable, and a cache restart is not fatal.**
  `RevocationReconciler` in `apps/workers` sweeps the outbox and replays revocations into the
  set. The failed write is the smaller reason: Valkey is a cache, so a restart empties every
  project's set and the published snapshot starts telling every customer that nothing is
  revoked, with nothing in the request path to notice.
- **The set is keyed by the instant of the revocation, not the instant of the write.** That is
  what makes replaying free: a sweep lands on the entry it already wrote, and the entry still
  ages out on schedule. Key it by write time and every pass pushes every expiry forward, so a
  set bounded by retention becomes a set bounded by nothing.
- **The reconciler reads a window, never a cursor, and never touches `published_at`.** That
  column belongs to the relay that will drain the outbox to Pub/Sub, and two consumers sharing
  one watermark is a bug waiting for the second one to be written.
- **`revocation_events_since` is SECURITY DEFINER and deliberately narrow.** A relay serves
  every project and has no `app.project_id`, so the read has to cross tenants. It returns two
  topics and nothing else, which is what stops it becoming a way to read every event any
  project has emitted. A test fails if that filter goes.
- **Retention is one access token lifetime plus skew.** A token minted immediately before a
  revocation expires one lifetime later, so nothing older can still be presented. That bound
  is the only reason the set is small enough to publish whole, and pruning runs on write as
  well as on read, because pruning only on read let a deployment with no poller grow forever.

## Adding an authentication flow

Extend `AuthFlow` in `@idenzy/domain` and implement `verify` only. The base owns MFA
gating, hook invocation, session creation and audit ordering, and a flow that wanted to
skip any of them would have to stop extending it, which is visible in a diff. Sign-up is
an `AuthFlow` too: establishing the subject there means creating them.

`verify` returns an `AuthenticatedSubject`, whose `factorVerifiedAt` says whether the flow
itself proved a factor rather than whether one is owed. That is the gate's business, and
`authenticate` therefore returns a session *or* a challenge (ADR-0010).

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

## Working on the second factor

Five rules, and the first one is the shape everything else hangs off.

- **An authentication ends in a session or a challenge, and never an error** (ADR-0010).
  `AuthFlow.authenticate` returns a union, the wire discriminates on `status`, and `@idenzy/js`
  mirrors it as `AuthResult`. A first factor that verified is not a failure: modelling it as one
  would put the normal path of every MFA sign-in in the same `catch` as a wrong password, and a
  session object with a nullable token compiles everywhere and fails on a later screen. Every
  flow returns it, including the ones that cannot challenge, because which those are is our
  decision and it changes.
- **The gate decides, not the flow.** `MfaGate` is consulted where the old throw stood: after
  `verify`, before the hooks, before anything that creates a session. It answers null for a
  subject that already carries a `factorVerifiedAt`, which is what stops a passkey ceremony
  being followed by a demand for a code, and null for a user with nothing enrolled, because a
  challenge nobody can answer is a sign-in that cannot be completed rather than one refused.
- **One refusal, whatever went wrong.** `MfaFactor.check` returns a boolean and only the base
  throws, so a wrong code, a spent step, a crossed-off recovery code and a factor the user never
  enrolled are indistinguishable. Everyone who reaches a challenge has already got past a first
  factor, which is exactly where a stolen password puts an attacker.
- **A proof is not a string, and holding a factor is not owing one.** `check` takes the
  protocol's discriminated union, because a passkey assertion is not a code; every factor
  refuses a proof meant for another in its first line, which is both the guard and the
  narrowing. And `demandsChallenge` is separate from `enrolled`: an authenticator turns MFA on
  for the account, a passkey and a recovery sheet only answer a challenge something else
  demanded. Collapsing the two would make enrolling a passkey a change to every password
  sign-in on that account.
- **A TOTP code is spent by writing its step back.** `Totp.verify` returns the step rather than a
  boolean for that reason: a code is valid for its whole thirty seconds, so the only defence
  against one read over a shoulder is refusing a step already used. The counter moves with a
  `greatest()` guard, because two requests inside one step would otherwise let the second write
  it back down.
- **A recovery code is spent scoped to its user, never looked up by digest.** They are compared
  by value, so a lookup on the digest alone would sign the caller in as whoever owned the code.
  They are 100 bits, which is what makes SHA-256 defensible where a six-digit OTP needs Argon2id;
  Argon2id could not be used here anyway, because a submitted code is checked against every
  unspent code the user holds.

Two more things are easy to get wrong by accident. Recovery codes go with the last factor when
it is removed: ten single-use passwords must not outlive the thing they were the fallback for,
on an account whose owner believes they turned MFA off. And a step-up challenge is pinned to the
session it was minted in as well as to the user, or a device that proved nothing inherits a proof
made somewhere else.

`assertRecent` is called from the service performing the action rather than from a guard. A guard
would have to run after `SessionGuard`, and getting that order wrong is a silent bypass rather
than a loud failure. It lets a user with nothing enrolled past, which is the honest shape of the
guarantee: the check is worth exactly as much as the second factor behind it.

## Working on claim templates

What a project's access tokens carry beyond the claims we assemble ourselves. Five rules.

- **The claimable user fields are an allowlist, and it is `publicUserSchema`.** A column
  added to `users` tomorrow is not publishable until somebody adds it to
  `CLAIMABLE_USER_FIELDS`, and `satisfies readonly (keyof PublicUser)[]` is what stops that
  list drifting from the profile endpoint. A denylist would have made a password hash
  claimable the day it was forgotten.
- **The reserved names live in `@idenzy/protocol`.** A dashboard validating a template and
  the issuer applying it check the same list, because the alternative is a template somebody
  can save and never use.
- **A required claim that resolves to nothing fails the issue.** A claim an authorisation
  check branches on is one where absent and false read the same, so emitting the token
  without it would let a sign-in through a check that never ran. Absent, never `null`: a
  verifier reading `null` has to decide what it means and every one of them decides
  differently.
- **The bytes are capped twice.** A save sees only names, and a render is the first thing
  that sees a value: a template of three short names can still render a profile blob. A
  token silently trimmed of the claim an authorisation check reads is worse than a sign-in
  that says it could not be completed.
- **Mapping `metadata_private` needs an acknowledgement, and what is stored is when it was
  given.** That column is the one place a customer keeps what they did not want a browser to
  see, and a token is read by everything the device sends it to. The question a reviewer asks
  is when somebody agreed, not whether a box is ticked.

`SessionService.mintAccessToken` takes the `User` and reads the template itself, so a new way
of minting a token cannot leave a project's claims out. That read is a primary-key lookup on
a tiny table; the project-config cache PROJECT.md 4.2 assumes is what removes it, and nothing
else wants one yet.

## Adding a provider, factor or channel

Extend the family's abstract base in `@idenzy/domain/ports` and implement only what
varies. The base owns what must never be skipped: the state check for OAuth, the
suppression check for email, the spend reservation for SMS, the single refusal for an
MFA factor. Do not re-implement those in
a subclass, and do not add an abstraction until there are two real implementations.

For an OAuth provider that means an endpoint pair and a profile mapping, plus running
`OAuthProviderConformanceSuite` from `@idenzy/testing`. Two rules the suite cannot check
for you. `emailVerified` must be false whenever the provider does not explicitly assert
otherwise, because that field alone decides whether an account can be linked on an
address. And the subject must be the provider's immutable id, never a username or an
address: GitHub logins can be renamed and handed to someone else, and a Slack member id is
unique only inside a workspace, so its subject carries the workspace too.

Where the wire format differs the base already has the hook, and it is one hook per
decision rather than one per symptom. `clientAuthentication` returns `basic` for the six
providers whose token endpoint refuses credentials in the body, and it moves the secret
into the header **and** drops `client_secret` from the form, because RFC 6749 forbids
presenting them both ways and doing half of it is accepted by some providers and refused
by others. `tokenEncoding` returns `json` for Notion alone, whose API takes nothing else
and reports a form as an error about the grant type.

A concrete provider needs an explicit constructor that only calls `super`. It is not
useless: it widens the abstract base's `protected` constructor to `public`, which is what
lets the registry build one. Biome flags it, so the suppression carries that reason.

## Working on the SMS path

The one channel where a request costs us money before it reaches anybody, which is why
almost everything here is stricter than its email equivalent (PROJECT.md 4.8).

- **The order of the checks in `SmsFraudGuard` is the design, not a sequence.** Placing the
  number is first because it is free and settles two refusals on its own. Attestation is
  next, *before any counter*, because a counter is a write: without that ordering anybody
  could exhaust a stranger's daily allowance by naming their number, and the victim would
  find their own sign-in refused having never been sent a code. Three tests fail if it moves.
- **Every counter on this path is strict, and `check` is not the method to use.**
  `RateLimitStrategy.check` fails open, which is right for a sign-in attempt and wrong here:
  allowing what we could not count turns a Valkey outage into an unmetered send window.
  `checkStrictly` propagates the store's error and the guard turns it into a refusal that
  says "later" rather than "our cache is down".
- **The spend cap lives in Postgres, and the reservation is one statement.** A cache cannot
  hold a limit whose failure mode is an invoice. The check and the increment are a single
  conditional upsert, because a read followed by a write lets two sends that each fit under
  the cap both pass. The first send of a day takes the insert branch, which no `setWhere`
  covers, so the caller's own cost is compared against the cap before the statement runs.
- **A reservation that was never settled stands.** A dispatch that threw may still have put
  a message on the wire, so the day is left overstated rather than released. `settle` takes
  what was reserved *and* what was charged, because a ledger holds the day's total and not
  this send's share of it.
- **`ProviderRouter` never retries.** The failed send already reserved the spend and already
  spent the number's velocity, and a gateway timeout is the case where the message usually
  went out. Failover is on the next request. Same reasoning as never retrying a refresh.
- **The allowlist is ISO country and the geography reads libphonenumber's `max` metadata.**
  Twenty countries share +1, and a project allowing the United States must not thereby be
  allowing every Caribbean range on the prefix. A number that cannot be placed is refused:
  an allowlist that admits what it could not identify is not one.
- **A project with no `sms_policies` row sends nothing**, which is the same answer as an
  empty allowlist. "Nobody configured this" is not a reason to start spending.
- **`UnconfiguredAttestation` answers false for everything.** A verifier that accepted what
  it cannot check would make `attestation_required` read as protection while being none. It
  does mean SMS is unusable on a project that requires attestation until a real provider is
  wired, and that is the intended failure.
- **An SMS is billed by segment.** `measure()` in `@idenzy/templating` is what prices a body,
  and the two numbers do not move together: the 161st plain character costs a second segment,
  and one curly apostrophe drops the whole message from 160 characters to 70. The built-in
  copy is ASCII and a test holds it inside one segment, because the failure is silent and
  arrives as a bill.
- **Both OTP flows check the challenge's channel against their own.** `OtpVerification`
  dispatches on the row rather than on anything the client said, and each flow checks again,
  because a dispatch is a convenience and that check is a guarantee: an SMS challenge
  resolved by the email flow looks a phone number up in the email column, misses, and creates
  an account with a phone number stored as an address, on a code the caller had every right
  to present.

## Working on `idenzy init` and the starter templates

`@idenzy/cli` writes working sign-in, sign-up, one-time-code and OAuth routes into a
customer's own repository. What it leaves behind is their code from the moment it lands:
they restyle it, rename it and never update it, which is the opposite of a component
dependency and the only honest way to promise a fast integration while shipping no UI
(ADR-0002). Nothing it writes may import a component of ours, because there is none.

- **A framework is a subclass of `FrameworkTemplate` and a line in the registry.** The base
  owns the environment file, its two keys and the install line; a template supplies the
  routes and the framework's own next steps. The registry's order is the detection rule and
  it runs most specific first: a Next application has React in it and a Nuxt one has Vue, so
  a general template listed too early would answer for the frameworks built on it.
- **`TemplateConformanceSuite` runs against every template.** It checks what a scaffold gets
  wrong quietly: a way in that is missing, an import the developer was never told to install,
  a path that climbs out of the directory they named, a secret key written into a browser
  bundle. It does not check that the scaffolded code runs, which would mean installing five
  frameworks to test five templates.
- **`examples/` is generated from those same templates**, so the starter a customer reads
  first cannot drift from what the CLI writes. Change a template, run
  `pnpm examples:generate`, commit the result; CI runs `pnpm examples:check` and fails when
  the two disagree, the same contract as the compliance artifacts. Biome does not lint
  `examples/` for the same reason it does not lint those: two writers of one file is a fight
  the generator has to win.
- **A file that is already there is kept, never overwritten.** The second run of `init` is
  the dangerous one, because by then the sign-in page has been restyled. `--force` is how
  somebody asks for the other thing, and the environment file is merged key by key so a real
  publishable key is never replaced by a placeholder from a flag.
- **The key is refused on its prefix, before anything is written.** A secret key scaffolded
  into a client bundle is published at the next build, and nothing after that unpublishes it.

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

## Working on the audit trail

The one control the whole compliance story rests on, and until recently it recorded
nothing: the table, the partitions, the append-only grants and the chain helper all
existed and no code had ever written a row. Five rules.

- **The chain has exactly one writer, and it is the relay in `apps/workers`.** Each entry
  links to its project's current tip, so two request handlers reading the same tip would
  both claim it and fork. Serialising that on the request path would queue every sign-in
  for a busy project behind the one before it, so a flow enqueues to the outbox and the
  relay drains it. Seconds of lag, and a chain that cannot fork.
- **`seq` is what makes "the tip" a question with one answer.** `created_at` ties at
  millisecond precision. Order by `seq`, never by time.
- **Everything the relay touches goes through a SECURITY DEFINER function.** A relay serves
  every project and sets no `app.project_id`, so `audit_events`'s FORCE RLS refuses its
  inserts and hides its reads. That failed silently once: no error, and a trail that stayed
  empty. None of the functions can UPDATE or DELETE, so the append-only grant from migration
  0001 still holds.
- **`ip` and `ua` are outside the digest.** They are the two fields a lawful erasure may
  pseudonymise, and a chain that hashed them would read a compliant erasure as tampering.
  What the chain protects is who did what to whom and when.
- **The watermark is the relay's own row in `relay_offsets`.** `outbox.published_at` belongs
  to the Pub/Sub relay, and two consumers sharing one watermark means whichever runs first
  decides what the other never sees.

## Compliance claims

The architecture is built for SOC 2, ISO 27001, GDPR and HIPAA. **No certification is
held.** Nothing in this repository may be quoted to a customer as a compliance claim, and
PROJECT.md 4.13.10 lists exactly what is not being done.

## Style

Conventional Commits, machine-checked. Docstrings short and informative: say what a thing
does and why it exists, plus the non-obvious constraint if there is one. Do not restate
the signature.
