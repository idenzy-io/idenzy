# The SDK packages

`@idenzy/js`, the seven framework bindings, the five SSR helpers, `@idenzy/node` and the
CLI. We ship no UI (ADR-0002), so these are the whole of what a customer imports.

## Working on `@idenzy/js`

The client half of the edge above. It may import `protocol` and `core` and nothing else, which
Biome enforces per path, and its `tsconfig` sets `types: []` with the DOM lib so a Node global
is a compile error rather than a runtime one in somebody's browser.

- **A custom auth domain is an API host, never a page.** `auth.customer.com` is a CNAME at our
  load balancer that a customer's own React page sends `fetch` calls to. Nobody navigates to it,
  it serves no HTML, and the customer's sign-in page stays wherever they put it. Say it that way
  when it comes up: "you need an auth domain" reads as "we host your sign-in screen", which is
  the one thing this product does not do (ADR-0002).
- **Loopback is `localhost`, `*.localhost`, `127.0.0.1` and `[::1]`, decided once** in
  `@idenzy/protocol/http/loopback` for the SDK, CORS, the origin allowlist and OAuth's instant
  mode. The subdomains are there because cookies are scoped by host and not by port: two
  applications on `localhost` share one jar and sign each other out, while `app-a.localhost`
  talking to `auth.app-a.localhost` keeps cookie mode and a jar of its own.
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

