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

## Working on the client panel

`apps/client` is the customer dashboard (PROJECT.md 10.1): a Nuxt SPA with `ssr: false`,
Vuetify 4 for components, Tailwind 4 for layout, `@nuxt/icon` for Material Symbols, plus
VueUse, Pinia and ECharts. `apps/admin` is the same shape and does not have the stack yet;
copy this one when it does.

Run it with `pnpm --filter @idenzy/client dev`. `pnpm dev` at the root starts every app
through turbo, which is rarely what you want while working on one panel.

- **Two utility systems is the thing this setup exists to avoid.** Vuetify's utilities are
  switched off (`styles: { utilities: false }`), so `d-flex`, `ma-4` and `text-center` do
  not exist here and the Tailwind spelling is the only one. That is 236 KB of the 296 KB
  Vuetify would otherwise add, and it removes every name that collides.
- **Tailwind's utilities are imported unlayered, and that is load-bearing.** Vuetify 4
  puts its whole stylesheet in cascade layers and the module appends them after ours, so a
  later layer beats an earlier one whatever the specificity: inside `@layer utilities`,
  `class="p-6"` on a `v-card-text` silently does nothing. Unlayered wins over every layer.
  Preflight is skipped for the mirror-image reason: Vuetify's `styles/core` already resets
  the document and two resets fight.
- **Icons are Material Symbols through `@nuxt/icon`, and `<v-icon>` goes through it too.**
  Vuetify 4 does ship an `ms` set and it emits UnoCSS class names
  (`i-material-symbols:menu`) that nothing in this build generates, so
  `app/icons/material-symbols.ts` hands the name to `<Icon>` instead and
  `defaultSet: "custom"` stops the module overwriting it. One collection, one bundle. The
  webfont was the other option and weighs 4 MB unsubsetted.
- **The module is configured to never reach the network**, which is three of its four
  settings: it fetches from api.iconify.design by default, and a statically generated SPA
  has no server to answer its own icon endpoint either. `mode: "svg"` is part of the same
  argument, because CSS mode injects a style element that a strict `style-src` refuses.
  Those API URLs do appear in the bundle as dead constants from `@iconify/vue`; a network
  panel on a production build shows only same-origin requests.
- **An icon has to be bundled to exist, and an unbundled one fails silently.** The scan
  reads `app/**/*.{vue,ts}` — `.ts` is not in the module's default globs and the Vuetify
  alias map is a `.ts` file — so `material-symbols:search` written out is found and
  `` `material-symbols:${name}` `` draws nothing, with no error and no request. Names that
  cannot be written out go in `icon.clientBundle.icons`. **The scan runs once, when the dev
  server starts.** A name added to a file while `pnpm dev` is running is not in the bundle
  and draws an empty `<svg viewBox="0 0 16 16">` until the server is restarted, which looks
  exactly like a name that does not exist. Check the DOM before rewriting the icon: an empty
  `viewBox="0 0 16 16"` is a stale bundle, a `viewBox="0 0 24 24"` with a path is a working
  icon that something else is hiding.
- **`v-checkbox-btn` is a grid item with a name, and it grows.** Vuetify's selection
  control carries `grid-area: control` for the grid inside `v-input`, so in a grid of ours
  that names no such line it lands in an implicit column of its own and the row comes apart
  around it. It also has `flex: 1 1 auto`, so in a wide flex row it pushes its own label to
  the middle. Checkbox rows are flex rows with `flex-none` on the control, which is what the
  filter menus do.
- **A `SettingRow`'s text column has a `basis-48` floor, and it is what makes the row wrap.**
  With `flex-1` and no basis it shrinks to nothing instead, so a wide control beside it, a
  segmented control of four options, squeezed its own description into one word per line at
  390px. The floor is chosen against both ends: a switch still sits beside its text in a card
  that narrow, and anything wider drops under it. Every desktop row is unchanged.
- **`max-width` on a `v-dialog` is a cap and not a width.** The dialog is as wide as its
  content unless it is also given `width="100%"`, so a multi-step one sizes itself to the
  narrowest step and rewraps at every other. `ImportWizardDialog` asks for both.
- **A `DataTable` cell never wraps.** Every column is `nowrap`, so a row is one line high
  and a column of sentences is clipped rather than read. Reference prose goes in
  `SettingRow`s or in the card that owns it; the table gets short cells. And the columns
  shown by default have to fit the card the table sits in: a table wider than its card
  scrolls sideways, which puts the empty state and the pager out of reach. Anything past
  that is `hidden: true` and one click away in the columns menu.
- **A `PageHeader` carries no glyph.** The drawer already marks where the reader is, and a
  tile repeating it beside the title only moves the title off the page's edge. The `icon`
  prop is gone rather than left unused, so it cannot come back one page at a time; `mark`
  stays for the one case a glyph here says something the drawer does not, which is a
  person's picture on the user detail page.
- **`useStorage` is not auto-imported and looks like it is.** Nitro owns that name, so
  `@vueuse/nuxt` leaves VueUse's out; it resolves to nothing and the page dies at runtime
  with the build green. Use `useLocalStorage` or `useSessionStorage`, which are exported.
  `useLayout` collides the same way and is settled by `prefixComposables`, which leaves
  Nuxt's built-in under the plain name and Vuetify's as `useVLayout`.
- **`enableRules: false` is a workaround, not a preference.** `vuetify-nuxt-module` is on
  its 1.0 release candidate, the only line that supports Vuetify 4, and it still imports
  `createRulesPlugin` from `vuetify/labs/rules`. Rules graduated to the root export in 4.0,
  so the path does not resolve and the bundle fails outright. Revisit when it leaves RC.
- **Biome does not read SFC templates**, so `noUnusedVariables` calls every `<script setup>`
  binding unused, and `noUnusedImports` says the same of an import a template alone uses.
  Both are off for `**/*.vue` rather than suppressed per file. Biome also
  needs `css.parser.tailwindDirectives` to parse `@plugin` and `@source`; without it every
  Tailwind entry point is a parse error and the file goes unformatted rather than unchecked.
- **CodeMirror 6 is the panel's one editable code surface,** as individual packages rather
  than the `codemirror` meta package, which pulls every extension it ships. It is behind
  the email template workspace's own route chunk and no other screen loads it. It is also
  the one library here that writes a stylesheet at runtime, which a strict `style-src`
  would refuse; every real editor does, so that is the price of having one at all.
- **Versions live in the `catalog:` in `pnpm-workspace.yaml`,** like everything else here.
  `nuxi module add` writes a literal version into the package instead; move it.
- **`font-mono` is DM Mono, and medium is its heaviest weight.** The face ships static in
  300, 400 and 500 only, and `theme.css` loads the last two; a `font-bold` on a figure is
  synthesised by the browser and looks it. Figures go through `Statistic.vue`, whose
  formatting lives in `app/utils/format.ts` and is fixed to English on purpose.
- **A test under `test/nuxt/` is typechecked and one anywhere else is not.** That is the
  one test directory in Nuxt's generated `tsconfig` includes, so `pnpm typecheck` sees it
  and `vitest` finds it either way. A ResizeObserver never fires in a background tab, which
  is why the fit rule those tests cover is a pure function and not read off the layout.

Design tokens and the shared `ApiClient` belong in `@idenzy/ui` (PROJECT.md 10.3), which
does not exist yet. The theme colours in `nuxt.config.ts` are placeholders until it does.

## Syntax highlighting

Shiki, through `nuxt-shiki`, and it is configured once in `nuxt.config.ts` so a caller
passes the language and nothing else. Four things are not obvious.

- **The themes are objects, not names, and `bundledThemes` is empty.** The module can only
  import themes Shiki ships; the pair in `app/shiki/theme.ts` is handed straight to
  `codeToHtml`, which takes a `ThemeRegistrationRaw` and registers it on first use. They are
  Atom's One Dark and One Light, deliberately: syntax colour is something a developer already
  reads fluently and a block that agrees with the editor beside this tab is read faster than
  one that agrees with the sidebar. What is not borrowed is the background, which is
  `transparent` because the card owns the surface, and the values that fell under 4.5:1 on
  our own surfaces, which are stepped down their own hues and no further.
- **`defaultColor: false` is what makes a block theme-aware.** Both themes are rendered into
  every block and each token carries `--idenzy-code-light` and `--idenzy-code-dark`;
  theme.css picks between them off Vuetify's theme class. A single theme baked into the
  markup is the one thing on a screen that would not follow the reader's choice.
- **`.shiki` is `display: grid`, and that is a fix rather than a preference.** Shiki
  separates its line spans with a real newline, and inside a `pre` that newline is a line box
  of its own, so a block-level `.line` sets every block of code at double leading. A grid
  drops the whitespace-only runs and sizes its column to the widest line, which is also what
  keeps a long line scrolling sideways instead of wrapping.
- **Use `useHighlighted`, not `useShikiHighlighted`.** The module's composable is awaited in
  `setup`, which makes the calling component async: it suspends on mount, and a component
  that suspends after the page has painted drops its whole Suspense boundary to a fallback,
  so a page blinks because a card in it wanted colour. Ours awaits nothing and answers null
  until the highlighter has loaded, which is the caller's cue to render the same code as
  plain text.

Languages are declared in `shiki.bundledLangs` rather than fetched, for the same reason the
icons are: a grammar loaded on demand is a request to a CDN, and PROJECT.md 10.3 allows no
third-party origin here. A language not on that list is a line to add.

## Working on the lifetimes screen

`/tokens/lifetimes` follows `notes/tokens-lifetimes.md`. Three numbers a project decides,
in one group, and every other clock in the product as a reference table.

- **The three save as one policy, unlike the settings screens either side of it.** The
  idle window and the maximum lifetime constrain each other and the access-token lifetime
  decides what both cost, so a draft with `Cancel changes` and `Save policy` is the one
  save model for the three. A control that wrote itself would answer "what do these do to
  a session" once per keystroke from a policy that was never all there at once. The
  header badge stays on the *saved* policy while the card follows the draft, so what is in
  force is readable at every moment.
- **`policyChanges` exists because the three do not reach a session the same way.** An
  idle window is read at the next rotation, so it reaches sessions that already exist; a
  maximum lifetime is stamped at sign-in and never moved, so shortening it changes nothing
  for anybody signed in today. A screen that said only "saved" would leave an operator
  believing they had just shortened sessions they had not touched, and the review above
  the button says which is which per field.
- **`sessionTimeline` is deliberately not to scale, and says so.** The only interesting
  thing about three durations is which arrives first, and drawn to scale a one-day idle
  window against a one-year maximum is a stop sitting on the sign-in. Evenly spaced, the
  order survives every combination the controls offer. `SessionTimeline` is horizontal
  from `lg` and vertical below, and the last stop keeps a faded rail of its own: a line
  that stops three quarters across a row reads as unfinished, and a line that faded is not
  a line that continues.
- **`clockRows` takes the clocks other screens own as arguments.** This list used to keep
  its own copy of the password-reset window and call it deployment-fixed while the
  passwords screen offered a control that moved it. `FIXED_CLOCKS` is now the deployment's
  clocks only, the one-time-code family reads its lengths from `CODE` in `~/utils/otp`,
  and the step-up window and reset link come in from their own stores with a link to the
  screen that owns them. A table with confident, stale values is worse than no table, and
  a fixed value drawn as a disabled input is a control that lies about being one.
- **The revocation window is observed, never promised.** What the panel can see is that
  one integration polled the snapshot; that is not proof every verifier a customer runs
  holds a `RevocationCache`, so the card says "observed for one integration" and states
  what a verifier without one still waits out. Rounding that up to a project-wide
  guarantee would be selling one out of a single observation.

## Working on the claim templates screen

`/tokens/claims` follows `notes/tokens-claims.md`. It is the one screen in the panel that
does not save itself, and most of its shape is about saying so.

- **A persistent toolbar, and the words on it are the design.** It sticks under the app bar
  and carries the count of unpublished changes, Discard and **Publish template**. The dialog
  that adds a claim says **Add to draft**, never Add or Save. A first button that looks like
  publication is the misreading the note was written about, and a screen that reads like the
  autosaving ones beside it is how that happens.
- **A draft is held per project and never published into another one.** `commit` names the
  project it read the draft from, leaving the route asks first and so does closing the tab.
  The leave dialog offers Publish and leave, but only where publishing would go straight
  through; where it would not, it says which problem is in the way rather than leaving a
  missing button to be interpreted.
- **Required is a per-row control because it can refuse a sign-in.** A required claim that
  resolves to nothing answers `claim_template_unsatisfied`, so the consequence is written on
  the row rather than parked behind a tooltip, and the row's name and source are opened in a
  dialog instead: four controls fighting for one line is what put a claim's name in a field
  that wrapped under its own source at every width the panel is read at.
- **Three sample users, and the two that hold nothing are the point.** `profileOutcomes`
  renders the draft against a complete profile, an account that signed up a minute ago and
  one that signed up by SMS and has no address at all. A template judged against one
  synthetic complete profile is a template nobody has checked, so a refusal is a page-level
  strip naming who it locks out and the cards under the panes carry each verdict.
- **The preview is a before and an after.** `tokenLines` marks every custom line against what
  the published template renders for the same user, and the marks ride on Shiki's own line
  elements through a transformer: the block has to be tokenised whole, because a lone
  `"plan": "pro",` is not JSON and a grammar handed one line at a time reads its key as an
  ordinary string. Every line but the last takes a comma for the same reason. A changed line
  is tinted the colour of its change and carries the glyph as well, because a tint alone is
  not a statement. Nothing marks which lines are the template's and which the issuer's:
  dimming the issuer's held most of the payload under an opacity and read as disabled, and a
  bar in the accent down the custom lines was a blue stripe beside the only colours on the
  block that mean anything. Both were tried and both came out.
- **`ClaimTokenPreview` draws the block in the add-claim dialog too**, over the draft's own
  claims with the new line marked, and that is the point of it: a claim *is* a line in a
  payload somebody's code reads, and the row of labelled values this replaced asked the
  reader to assemble a token in their head. A refusal replaces the payload rather than
  floating over a greyed-out copy of it, because there is no token to show and a dialog has
  no height to float anything over anything.
- **The acknowledgement names keys and values, once, at publish.** It lists each mapped
  private key beside the value a token would actually carry for a sample user, and says the
  sentence a reader otherwise supplies for themselves and gets wrong: a token is signed, not
  encrypted, so the signature says nobody altered these values and nothing about who can read
  them.

## Working on the metric card

`MetricCard` is the panel's one chart surface, and every screen that draws a series goes
through it. The option ECharts is given is built in `app/utils/metric-chart.ts`, which is
pure and tested; the components read the theme and hand it over. Six things are load-bearing.

- **A canvas inherits nothing.** The faces are named as strings and the ink is read off
  `useTheme` through `useMetricPalette`, never off a stylesheet. The chart is painted before
  DM Mono has loaded and a canvas does not repaint itself when a font arrives, so
  `MetricChart` calls `resize()` on `document.fonts.ready`. Drop that and every axis label
  stays in the fallback face.
- **The tooltip is DOM that ECharts writes, outside any template.** Its styles are the
  unscoped block in `MetricChart.vue` under the `metric-tooltip` prefix, because a scoped
  block cannot reach it. ECharts is told to draw no box of its own and the markup carries
  the look. Series names go through `escapeHtml`: the markup is a string, and a series name
  is text from outside.
- **The legend the reader sees is HTML in the card, and ECharts' own is `show: false`.** It
  still holds `selected`, which is what switches a series off in both views. Colour is
  assigned by a series' position in the list and not by what is visible, so hiding the
  first does not repaint the second.
- **`chart-1` to `chart-6` are validated in that order.** Adjacent pairs were checked for
  separation under simulated colour-vision deficiency, in both themes, against the panel's
  own surfaces. Reordering or restepping one slot undoes the check. Three light slots sit
  under 3:1 on white, which is why the table view is not optional and a series is never
  told apart by colour alone.
- **A series that means good or bad wears the outcome colours, never a slot**, and a series
  that is merely fourth never wears an outcome colour. A chart of one series gets no legend.
- **Vertical gridlines are dashed and horizontal ones solid, both under a tenth of the ink.**
  The test asserts it, because it is the sort of thing a well-meant refactor evens out.

## Working on the usage screen

`/usage` follows `notes/usage.md`: the billing period beside the title, actual charges beside
the month-end projection and the hour the figures run to, active users against the allowance,
the activity chart, then the line items with who bills each. Export and the meter definitions
sit under the breakdown. `app/utils/usage.ts` holds every rule; the page only arranges it.

- **Money is cents from the first multiplication, and each line is rounded once.** `billFor`
  rounds every line to the cent, halves up, and totals the rounded lines. Billing's draw-down
  reads that `totalCents`, and the billing store raises each invoice from a closed period's
  `billFor`, so the three screens are one figure. They were a cent apart when one rounded the
  sum and the other the lines.
- **A projection is per meter, and says what it assumes.** `projectTotals` continues each meter
  at its last seven complete days' average and `projectBill` prices the result. Dividing the
  dollars by the month's progress projected a domain fee twice over and nothing for active
  users still under the allowance. Every projected figure reads "At the current average rate",
  and `PROJECTION_BASIS` says it overstates active users, who slow as a month goes on.
- **There is one definition of an active user.** `MAU_DEFINITION` is PROJECT.md's first-day-free
  rule written as one rule, any authentication on a day other than the account's first, and
  `MAU_EXAMPLES` answers the note's acceptance check about the user who only signs in on
  sign-up day. `MAU_SUMMARY` is its two-sentence form. Write it nowhere else.
- **Four kinds of nothing.** `LineState` separates the allowance, no usage, a vendor that bills
  the customer directly, and a meter that does not exist. A vendor line says "Charged by Idenzy.
  Twilio bills you separately." and names the vendor as its billing owner; logging reads "Not
  metered" and carries no charge rather than $0.00.
- **The chart compares with the same dates a month before, not the window before.** Active
  users are a level that starts again on the 1st, so the seven days before the 7th straddle
  the reset. `usageWindows` anchors at the hour the figures run to, or at a closed month's end.
- **The period is a query and a menu, never a dialog.** `?period=2026-08`, replaced rather than
  pushed, and the open month carries no query, so the month survives a trip to Billing and back.
- **Unknown is never drawn as a zero.** A failed read keeps the last figures, says when they are
  from and offers Retry; no figures at all is dashes and no total.

## Working on the settings screens

`/settings` is one page and three tabs: General (`index.vue`), Members and Account. The
parent route `settings.vue` holds the rail and renders `<NuxtPage />`, so each tab is a real
URL, `/settings/members` keeps the two links that already pointed at it, and the breadcrumb
can say "Settings / Members" because `NAV_SETTINGS` still names each child. `/account`
redirects to `/settings/account`.

- **The rail is navigation, not a tablist.** `SettingsTabs` is a `nav` of `NuxtLink`s marked
  with `aria-current`, and it must stay that way: `role="tab"` promises a panel that swaps in
  place, so announcing a route change as a tab leaves a screen-reader user waiting for
  content that has already replaced the page. It matches on `router-link-exact-active`, never
  `router-link-active`, or `/settings` lights while `/settings/members` is open. Vertical from
  `lg` and a scrolling strip below, because the blueprint asks for stacking rather than a
  120px column that truncates every label.
- **The ownership model is user, then organisation, then projects.** Every person belongs to
  an organisation, personal with one member and a team with more, and seats are free either
  way so neither is a tier (`orgKindOf` counts the members rather than storing a kind, which
  is what stops the label and the list disagreeing). An organisation holds as many projects as
  the customer has applications. So **the team and the wallet are the organisation's and the
  sign-in rules and the meters are the project's**: `members` and `billing` are keyed by org
  id, every other store by project id. That is what `orgs.billing_customer_id` and
  `projects.org_id` already say, and it is the first finding on all three settings notes.
- **Each rail row carries its scope** ("This project", "Organisation", "You"), because the
  three screens sit next to each other and own different things. A removal that said "this
  project" on an organisation holding three would take access the reader was not told about.
- **`ProjectFacts` carries no `orgName`.** The organisation comes from the project store,
  which the drawer and breadcrumb read, so there is one name rather than two to drift.
- **Retention is the General tab's one draft.** Five ages are one decision about what the
  purge worker sweeps, so they collect in a draft with `Cancel changes` and `Save changes` at
  the section's foot; the name goes through a dialog and nothing else on the page is editable.
  The audit subject is not in the draft at all, because it follows the tier and an override
  would be a number the worker ignores.
- **The members screen's second-factor requirement is recorded and not enforced.**
  `MFA_ENFORCED` is false: there is no enrolment step inside the dashboard's own sign-in, so
  `MemberMfaDialog` says the requirement is recorded and a member without a factor still gets
  in. The note's P1 is that the transition has to exist before the promise does.
- **An address change moves nothing until both sides confirm.** `startEmailChange` writes an
  `EmailChange` beside the profile and the live address keeps working; patching `email` with
  `emailVerified: false` reads as a move that happened, on an account whose owner can still
  only reach the old mailbox. `ACCOUNT_WRITES.running` is false and the tab says so once at
  the top, because nothing on it reaches a server yet.
- **The danger zone is last and in its own frame**, on both General and Account, and never
  beside Rename. The resource counts live in the delete dialog, which is where the decision
  is actually made.

## Working on the billing screen

`/billing` follows `notes/settings-billing.md` and is top-level rather than a settings tab:
the wallet is the organisation's rather than one project's, and understanding a bill is its
own task rather than a preference. `app/utils/billing.ts` holds every rule.

- **Nothing charges anything, and the page says so first.** `PAYMENTS.running` is false:
  Stripe is not integrated, `orgs.billing_customer_id` is the only billing column in the
  schema, `management-api` registers a health controller and nothing else, and no worker
  consumes a payment webhook. `store.topUp` returns the refusal and writes nothing, Add credit
  is shown disabled with the reason, and the credit in the fixture is granted rather than
  bought. A local balance that grew because somebody pressed a button is the one thing this
  screen must never do (notes/settings-billing.md P1).
- **`CheckoutState` is named now so the dialog is built against it** rather than against a
  boolean. A card payment can be in flight, need the cardholder at their bank, be abandoned on
  the provider's page, or fail after being accepted, and a dialog that only knew "busy" would
  report the same thing for all four. The dialog stays open on a refusal with the amount still
  typed, because closing cleanly is the whole of the evidence a reader gets.
- **The balance is derived from credit grants, never stored.** A grant is `purchased` or
  `promotional`, promotional credit expires, and expired credit is worth nothing, so a stored
  total would keep counting it. `walletOf` splits it the way the reader asks about it.
- **`drawOrder` spends what would otherwise be lost first**: promotional before purchased, and
  inside each kind the soonest to expire first. The other way round, a promotional grant
  expires unused while purchased credit pays the bill, and the customer is right to call that a
  charge they should not have had.
- **Exactly one payment method is the default.** It is the one anything automatic charges, so
  `withDefaultMethod` moves it in a single change (two defaults is an argument about which one
  an unattended charge used, none is a rule that silently cannot fire), `withoutMethod`
  promotes a successor, and `methodRemovalIssue` refuses the last method while automatic
  top-up is armed. An automatic rule names its own method: "whichever is the default" changes
  what it charges when somebody else changes the default.
- **An invoice is the organisation's, and its total is the sum of each project's own rounded
  total for that month.** Never recomputed from combined meters: each project's lines are
  rounded once by `billFor`, and summing those is what keeps this screen, Usage and the
  invoice one figure by construction.
- **A past-due invoice replaces the runway rather than sitting beside it.** `paymentRepair`
  names the repair; an estimate of how long the credit lasts, printed over a bill nobody paid,
  is the optimistic reading the note asks to remove.
- **`autoTopUpEffect` says whether saving the rule charges immediately.** A threshold above the
  balance already held is a charge and not a safety net, and that has to be readable before the
  write.
- **The app bar carries no Top up button.** A funding action there competes with this screen's
  own, and at 390px it and the balance crowded out the one thing the bar has to keep, which is
  which project is being read. The balance is a link to `/billing` and desktop only.

## Working on the API keys screen

`/keys` follows `notes/keys.md`: the type tabs under the title, the keys of that type, any
rotation somebody started, then the reference folded away. `app/utils/keys.ts` holds every
rule; the page arranges it.

- **A rotation is started, never inferred.** `rotationsOf` returns only a live replacement whose
  `replaces` names a live key. Two live keys of one kind are two keys: the newer is as likely to
  be an undeployed replacement as the key traffic moved to, and the old screen ranked them by
  last use and recommended revoking the wrong one. Rotate is on a key's menu and nowhere else,
  and `replaces` is a proposed `api_keys` column, like a purpose.
- **An observation is not a census.** `last_used_at` says when a key was last presented, not who
  else holds it, so the words are "No observed use in 24 hours" with `OBSERVATION_WINDOW_HOURS`
  and `OBSERVATION_LIMIT` beside them, and nothing says "safe". The revoke dialog asks about
  consumers every time, a key silent for days included: that is the weekly job.
- **A replacement nobody has presented is never finished.** `rotationHeadline` answers "Deploy
  the replacement" until the replacement is observed, however old it is. Review revocation is
  offered throughout and becomes the primary action only once the replacement is observed and
  the old key has not been since.
- **Purpose is said to be proposed, once, above the list.** The row has no column for a name,
  and a label kept only in the panel would disagree with every other client of the API. Created
  by is real: it is the actor on the audit trail's `key.created` entry, and null past retention
  reads "Not recorded".
- **Compromise is the other procedure.** Revoke now on the menu, and Revoke now instead in the
  rotate dialog, open the revoke dialog in its `compromised` form, which asks about the breakage
  rather than the consumers: revoke first, deploy after.
- **The reveal has an honest exit.** Persistent, a full-height sheet below `lg`, the value on one
  line that scrolls sideways with a labelled Copy beside it, and Close without copying, which
  says the key stays live with nobody holding it. No "I have stored this key" tick
  (notes/dialogs.md).
- **Browser configuration never holds a secret key.** `PLACEMENTS` spells the names the starter
  templates write: the browser list only under a public prefix, the server list never under
  one, and tests hold both. Only a key's detail shows them, and it copies a variable name,
  never a prefix with an ellipsis. The reveal shows the value alone.
- **All keys is the first tab and the page's own address.** It lists the live keys of both
  kinds, with every rotation under it. A live secret key wears `chart-6` there, read off
  `--v-theme-chart-6` so it follows the theme, which sets the two kinds apart in a mixed list;
  a kind tab, where every row is one kind, leaves it plain.
- **Show revoked adds the revoked keys to All keys and the kind tabs.** Off by default and
  remembered per viewer in `useLocalStorage`, because it is how somebody likes to read the list
  rather than a fact about the project. `tabCounts` takes the same flag, so a tab's count is the
  rows under it; the Revoked tab ignores it, and the checkbox is not offered there.

## Working on the webhooks screen

`/webhooks` follows `notes/webhooks.md`: the endpoints with their state and health, the one
selected with Edit and Send test event, its attempts by outcome over a period, its signing
settings, then the verifier and the guarantees folded away. `app/utils/webhooks.ts` holds the
rules; the selected endpoint is `?endpoint=`, replaced rather than pushed.

- **Nothing delivers, and the page says so first.** No worker consumes the webhook topic and
  `webhooks.secret_hash` is a digest, which can check a secret and cannot sign with one.
  `WEBHOOK_DELIVERY.running` is false: `deliveriesFor` answers nothing rather than the sample
  attempts, health reads "Not measured", and Send test event and Retry delivery are shown
  disabled with the reason beside them. An attempt on this screen is a claim that we called
  somebody's URL, which the note's acceptance check forbids. Flip the flag to see the
  workspace populated.
- **The verifier sample is executed by the tests.** `VERIFY_BODY` is plain JavaScript, and
  `webhooks.test.ts` runs that exact text against HMACs from `node:crypto`: a rotation's second
  signature, a fetch `Headers`, and malformed headers that must answer false without throwing.
  It parses the `sha256=` scheme and checks the length before `timingSafeEqual`, the two things
  the old sample got wrong.
- **Retry and test are different acts, and each says so where it is offered.**
  `RETRY_SEMANTICS` is the same delivery again under the same delivery ID; `TEST_SEMANTICS` is a
  new delivery of `webhook.test`. Retry sits at the foot of the attempt detail, under the ID.
- **Why an endpoint is off is on its row.** `EndpointDisabled` separates a person pausing it,
  named, from the switch-off after `FAILURES_BEFORE_DISABLED`. The remove dialog offers Pause as
  the safer choice; neither queues anything, and resuming replays nothing.
- **Rotation is in signing settings and names its deadline** in `WebhookRotateDialog`, before
  anything changes. The secret dialog repeats it, has no "I stored it" tick, and offers Close
  without copying. Where the secret is kept is stated as unsettled rather than promised.
- **The event groups are an accordion.** `WebhookEventGroups` opens the first group, allows any
  number open, gives each group a line of its own and a checkbox that takes or leaves it, mixed
  while partial; a folded group still counts what is chosen in it. Asked for by name: the flat
  list of thirteen read as too much.
- **Observed delivery is a figures strip, and while nothing runs it reads No data.**
  `deliveryFigures` counts seven days of deliveries by outcome. With none, every `UsageTile`
  draws its faint wave and No data, the answer the allowed origins screen gives, rather than
  four zeros that read as a clean record.

## Working on the hooks screen

`/hooks` follows `notes/hooks.md`: a one-line webhook decision under the title, the figures,
the five hook points with readiness, deadline and failure rate, then signing and failure folded
away. Configure opens a hook's own configuration, which owns its endpoint, deadline, contract,
check and Enable. `app/utils/hooks.ts` holds the rules.

- **A hook's configuration is a dialog, not a block under the list.** Asked for by name: the
  note draws it inline, and built that way it read as a second section below the fold. It is
  capped from `lg` up and a full-height sheet below, and `?hook=` names it, replaced rather than
  pushed, so a link opens it. The edits it offers stack over it instead of closing it, because
  the reader comes back to it to validate and enable; the security centre closes its detail
  first only because its dismiss is destructive.
- **Nothing calls a hook, so nothing can be enabled.** `FlowHooks` has one method, bound to
  `NullFlowHooks`, which answers yes without calling anybody, and the other four hooks have no
  call point at all. `HOOK_CALLS.running` is false: `store.enable` refuses, `statsFor` answers
  null so the figures read No data, and every fixture that would read as an enforced gate stays
  behind the flag. A gate that exists only in local state is the note's first P1.
- **Enable waits on a check of the configuration as it is now.** `checkHook` runs the address,
  the secret and the budget here, then a signed call and a wrongly signed one where a call can
  be made. `isCheckCurrent` ties a check to the URL and deadline it ran against, so a change
  reads as not validated. `enableBlocker` puts a failed check before the missing caller, because
  only one of the two is the reader's to fix. The call half says "Not run" today, never passed.
- **An unreachable endpoint saves, then fails its check.** `unreachableReason` knows the
  special-use names (`.invalid`, `.test`, `.internal` and the rest) and the private IPv4 ranges.
  The form cannot know a tunnel is about to be set up, so it saves; the check is where it fails,
  before anything is enabled, which is the note's first acceptance check.
- **A new URL on an enabled hook is validated before it replaces the live one.**
  `replacesLiveEndpoint` turns the dialog's action into Validate and save, and a failure leaves
  the current URL called and says so. Turning the gate off to change an address would drop a
  policy for the length of a redeploy.
- **A hook has a secret of its own, one per project.** The old copy said hooks were signed with
  "your webhook secret", which named nothing: webhook secrets are per endpoint and a project can
  hold none or several. The first endpoint makes the hook secret and `HookSecretDialog` shows it
  once; rotation is in the Signing fold and names the overlap and the fail-closed consequence.
  The headers and the scheme are the webhooks' own, re-exported so the two cannot drift.
- **The budget is per path.** `addedTo` counts before-sign-in and customize-claims on a sign-in,
  adds before-sign-up on a sign-up, and never counts the two that send. The old header summed
  all three as one sign-in figure.
- **Turning off a gate names what stops being checked.** `HookRemoveDialog` asks an enabled gate
  for an acknowledgement stating the sign-ins or sign-ups it will no longer check, with Keep gate
  beside the action. A hook that is not enabled enforces nothing and goes without one.

## Working on the social providers screen

`/methods/providers` follows `notes/methods-providers.md`. It is an integration screen and
not a settings one: what is blocking, the providers and the state each is in, the return
URLs they share, whether the whole thing works, then the linking rule. Single column, like
passkeys, and the catalogue is not on the page at all.

`app/utils/providers.ts` is the panel's catalogue of the eighteen adapters registered in
`apps/auth-api/src/oauth/oauth.module.ts`, plus the generic OIDC connector, which is shown
grey because "not supported" and "not yet" read differently. `app/utils/auth-providers.ts`
derives the four marks our own sign-in screens use from it, so there is one answer to what
Google looks like.

- **Configured and working are different questions, and `readinessOf` is the answer to the
  second.** A provider is `incomplete`, `off`, `development`, `untested` or `ready`, in that
  order of precedence: a gap outranks a decision because switching on a provider that cannot
  exchange changes nothing, and a decision outranks a restriction because a provider nobody
  can reach is closed rather than localhost-only. The row leads with that state and its
  button is named after it, so Manage, Finish setup and Use your own app are the same
  control saying which of three things it is for.
- **`untested` is a statement and not a fault, and the test is a real sign-in.** Whether the
  provider console holds our callback is the one thing this end cannot see: a wrong redirect
  URI is refused at their consent screen, before we are called. So the workspace's last step
  says that beside the checks it *can* run, and starts a real sign-in. Where it can: a
  top-level navigation resolves a project by `Host` alone, so only a project with a verified
  custom auth domain can be sent to the start route, and one on the shared API host gets the
  SDK call to run from its own application. `testedAt` records that a sign-in was run, never
  that it passed, because where it ended is the customer's return page and not ours.
- **`email` is the field the catalogue file exists for.** Whether a provider asserts the
  address it hands over is verified is what decides whether a sign-in may join an account
  somebody already has (PROJECT.md 4.6). Ten of them state it and eight do not, and the
  eight report unverified because their provider states nothing rather than because nobody
  checked. It is on the row and worked through on the linking card, and deliberately *not*
  on eighteen catalogue cards: it appears in the workspace once a provider is picked, which
  is the first point a reader can act on it.
- **Two different URLs both called a redirect, and they get a step each.** Ours
  (`/v1/auth/oauth/:provider/callback`) is fixed by the deployment and goes in the provider
  console; theirs is a row of `redirect_uris` under the `oauth` kind and is where we send the
  browser afterwards with a code. Registering one where the other belongs is how a first
  setup fails, and it fails at the provider's consent screen where the user sees an error and
  the operator sees nothing. Neither is a CORS origin, and the return-URL dialog offers that
  origin as a separate tick (ADR-0006), never as a consequence.
- **The return URLs belong to the project, not to a provider.** One list, shared by all of
  them, because the code is ours whichever provider minted the identity. It has a card on the
  page as well as a step in the workspace, since the blocker and the check both need
  somewhere to send a reader. Those URLs are a third source for the Allowed origins screen's
  suggestions, which is why `suggestionsFrom` is keyed by source rather than positional.
- **A provider that is on and incomplete is a page-level blocker.** It fails after the user
  has already agreed at the provider, which is the one failure invisible from both ends, so
  `providerBlockers` raises it by name with the missing field.
- **The client secret goes one way.** The panel holds `secretSet` and when it was written,
  never the value, so the field on an existing provider is a replacement and a blank one is
  a keep. Clearing is not offered: a provider without a secret cannot finish a sign-in, and
  removing it from the project is the honest way to say that.
- **Credentials are one write and everything else writes itself.** A switch, the linking
  rule and a return-URL edit save on the spot like the passwords and passkeys screens; the
  credential set goes through the workspace because a provider half saved fails at the token
  endpoint rather than in the panel. Same reason the passkey relying party is one write.
- **Opened over a provider that exists, the workspace is tabs and not a funnel.** `Steps`
  takes a `reached` id for that: somebody rotating a secret must not walk past two steps they
  are not changing. Adding one stays a funnel until the credentials are written.
- **Both credential fields are named and the secret is `new-password`.** A text field
  followed by a password field is a sign-in form as far as a browser is concerned, and it
  will put the operator's own address in the client id and their panel password in the
  secret, which saves cleanly and fails at the provider.
- **Instant mode is shown as a warning wherever it appears.** It is our shared app, our name
  on the consent screen, and refused anywhere but localhost and preview domains, so a row on
  it says so in full rather than wearing a quiet pill.
- **Removing a provider keeps the identities.** What comes off is the credentials, so
  setting it up again recognises everybody who used it. What the dialog states is the number
  of accounts with no other way in, because for them a removal is the account.

## Working on the SMS providers screen

`/sms/providers` follows `notes/sms-providers.md`. The two arrangements, the project's own
destinations, delivery health, then the catalogue folded away.

- **Two panels, never a segmented switch.** Managed delivery and a customer's own account
  are not two settings of one thing: the estimate, the billing owner and the readiness are
  three answers that differ between them, and a toggle offers no way to compare three
  answers. Each panel states its own and carries its own action inside it.
- **Nothing reads as carrying traffic, because nothing does.** Every vendor adapter is a
  port with no implementation, so no `SmsProviderInfo` is `live`, `transportWired()`
  answers false, the store's `traffic()` returns nought rather than the fixtures, and the
  route column is `Intended route` and hidden by default. A test asserts the first two. The
  claim this screen must not make is the one nobody can check from the panel.
- **Delivery health is a figures strip, so it leads.** The note draws it under the table;
  built that way it put the one thing an operator glances at on arrival three screens down.
  Same rule as the revocation screen: figures strip, then the operational content, then
  everything else. The tiles are `UsageTile`, which draws a faint wave and `No data` in
  words rather than a chart of nothing.
- **Per segment, and the rates are examples.** The column is `Price per segment` and
  `RATE_SOURCE` says once that the figures are the published wholesale plus our margin held
  in the panel, not a live feed. "Per message" was the old column title and it contradicted
  the prose beside it.
- **`routeReadiness` answers per row, and the deployment's gap is stated once.** The
  allowlist first, because it is the project's own and free to change, then the
  registration; a blocker true of every row at once goes above the table instead. Every
  Action links to the flow that settles it, never to a general guide.
- **Connecting an account is verify then activate.** `Verify account` presents the pair to
  the vendor; only a success turns the footer into `Use this account`, and editing either
  half makes the answer stale. A refusal keeps the vendor and the key, clears the secret,
  and switches nothing. The clear is the component's own, so it must not mark the answer
  stale and take the refusal off the screen with it.
- **A changed column set needs a new `useLocalStorage` key.** `reconcileColumnState` keeps
  what a reader remembered, so reusing the old key brought the illustrative route column
  back for anybody who had visited before.

## Working on the allowed origins screen

`/domains/origins` follows `notes/domains-origins.md`. It is a diagnosis screen, because a
missing entry fails silently: the API answers normally, the browser discards the response,
and the customer reads it as the SDK being broken.

- **An empty answer here is not evidence, and the screen says so.** Nothing records the
  `Origin` on a request, so the figures read no data, `Last observed use` says "Not
  recorded", and `unknownFor` returns nothing while `ORIGIN_TELEMETRY` is false. On this
  list a false "nothing was refused" is the most expensive answer in the panel, because it
  looks like proof that nobody was blocked.
- **`checkOrigin` is the point of the page.** A whole application URL in, the origin it
  reduces to shown before anything is offered, then one of four verdicts: allowed, blocked
  and addable, refusable by a rule this list holds, or a URL with no origin at all such as
  `myapp://callback`. Watching the path and the query fall away is most of what it teaches,
  so the reduction is drawn as `asked → origin` rather than silently applied.
- **The empty state names who is affected.** "No browser can complete a sign-in" was
  broader than the condition: a server calling the API sends no `Origin`, and localhost is
  allowed by the deployment while it runs in development. Say browser origins you deploy to.
- **A suggestion is one row, one source, one grant.** `ORIGIN_SOURCE_FROM` names the screen
  it came from rather than the protocol's word for it, the URL it was read off is not
  repeated, and the section says what allowing one grants — allowing is still an ordinary
  write, and nothing on the screen it came from changes (ADR-0006).

## Working on the security centre

`/security` follows `notes/security.md`. Two tabs: a queue somebody works down, and the
detectors somebody comes to once.

- **Every count on the screen comes from the rows on the screen.** The strip said twenty-two
  open over a list of ten, because the figures were the project's totals and the list was the
  window. `scope` is computed from `filtered`, and the strip says which view and which period
  it is counting.
- **Observed, configured and enforced are three different facts.** `RESPONSE_ENFORCEMENT`
  says what each response actually does today: only `record` is carried out, because nothing
  raises a challenge from a detector and nothing sends a notice from one. `enforcedResponse`
  degrades the rest, `detectorStatuses` reports all three, and a row whose configured and
  enforced disagree says so with a link to where the missing half is built. Never let a
  setting be read as the behaviour.
- **The one code sample here is copied by developers, so it is the protocol's.** The page
  showed `status: "challenge"` with a `reason` field; the union is `authenticated` /
  `mfa_required` and the challenge has no reason (ADR-0010). Mirrored into
  `utils/security.ts` with the source named — the panel takes no dependency on
  `@idenzy/protocol` until the management client does — and pinned by a test.
- **"Always" is only for what is running.** `DEPLOYMENT_DEFENCES` marks Cloud Armor
  `unavailable` because it is designed and not provisioned; the application rate limits, the
  constant-time answer and refresh-reuse revocation are `enforced`. The same rule as the SMS
  vendor states: an unfalsifiable claim is one that is only tested during the incident.
- **The queue is `DataTable` and the detail is a dialog.** The note draws a 5/7 split;
  five columns left nowhere for the account a row is about, which is the column somebody
  traces a signal by. The table gets the page and `SignalDetailDialog` opens over it: the
  signal cell is the way in, as a person's name is on the users list, and the ellipsis keeps
  the less frequent actions. Opening the dismiss dialog closes the detail first — two
  overlays deep is a reader who cannot tell which Cancel they are pressing.
- **Inside the detail: evidence, the innocent explanation at the same size, the person and
  their sessions, the decision history, then the actions.** Acknowledge is neutral and flat,
  Dismiss is text, and signing out is the only destructive one and sits apart from both.

## Working on the audit log

`/audit` follows `notes/audit.md`. Search and every filter above the record, the trail in
eight columns, who and what is excluded in four.

- **What the view leaves out is a chip, not a rail switch.** The end-user activity starts
  set aside because on a live project it is nine rows in ten, but the chip carries the count
  and its own way off, and the period control ends at `All time` rather than `All`: `All`
  over a view that excludes most of the trail is the one word this screen must not use.
- **`ACTION_ACTORS` says who can have done what, and the fixtures obey it.** A service
  credential has no browser and no password, so it cannot sign in to the dashboard or accept
  an invitation; the trail said otherwise and an audit story that contradicts the role model
  undermines the thing it is evidence for. `weightedFor` in the store draws from the actions
  that actor could author, and tests pin the constrained pairs.
- **The flag is `Sensitive` and it has a written rule.** `SENSITIVE_CRITERION` names what
  earns it and ends by saying an unmarked entry is not a less important one. "Worth reading"
  was an editorial judgement about the rest of the trail.
- **Say what the guarantee is and stop there.** The runtime role holds INSERT and SELECT and
  the chain makes an alteration detectable; neither means nobody with direct access to
  storage can change a row. `INTEGRITY_CLAIMS` is those three sentences, and the middle one
  says detectable is not the same as impossible.
- **A detail reads: what moved, the request, then the chain.** `from`/`to` in the metadata
  become a before and an after at the top; `requestId` is a field on `AuditEvent` rather than
  a line in the metadata blob, so it is a column, searchable, and in the CSV. Hashes last.
- **Metadata is Shiki through `CodeBlock`.** `json` is already in `shiki.bundledLangs`, the
  block renders plain until the highlighter loads rather than suspending the row, and an
  entry with no metadata draws nothing rather than an empty pair of braces.
- **Export states its scope before it downloads.** `auditScope` builds the lines and
  `AuditExportDialog` shows them: project, period, count, every filter, and whether the
  end-user activity is in the file. Empty is an answer about the filters, not a failure.

## Working on the data requests screen

`/data-requests` follows `notes/data-requests.md`: the counters that filter the queue, the
queue in deadline order, then a request opened over it with its receipt, its verification,
the work and the answer. `app/utils/data-requests.ts` holds every rule; the page arranges
them.

- **The deadline runs from receipt, on the calendar, under a named rule.** `dueFrom` adds
  the rule's period to `receivedAt` and ends on that day, so the 31st of August is due on
  the 30th of September, and a request typed in five days late is due on the same day as
  one typed in on arrival. The old screen added thirty days to the moment of logging and
  called a fixed interval statutory, which are the note's first two P1s. `RULE_INFO` holds
  GDPR and CCPA, `CALENDAR_NOTE` says the panel never rounds a date later than the rule's
  own, and which rule applies is stated as the privacy owner's decision rather than ours.
- **A request closes on evidence, never on a badge.** `workDone` reads a finished export, an
  erasure record, a correction, or a check that found no account; `canClose` wants that and
  a recorded answer, and the store refuses the write without them. `nextActionOf` is the one
  primary action a request offers and `actionBlocker` says why it cannot be taken where it
  cannot, which is what keeps the footer to a single valid step.
- **Refusing is its own act with its own record.** `refusalIssues` demands the grounds, the
  reasoning in writing, the day the person was told, and an acknowledgement that the message
  said what the rule requires (`RULE_INFO[rule].refusalNotice`). Mark completed and a bare
  Refuse were the third P1.
- **Nothing builds an export, and the page says so first.** `EXPORT_JOBS.running` is false:
  `prepareExport` refuses, the footer shows the reason beside a disabled action, and the
  fixtures carry no export runs, because an export drawn here is a claim that somebody's
  data was assembled. `OVERDUE_ALERTS.running` is false for the same reason the old copy was
  wrong: todo.md still lists due-date alerting as unbuilt, so the screen says an overdue
  request shows in this queue and nowhere else. Flip either flag to see that half populated.
- **An erasure runs the users store's own.** One action in one place, so an erasure answered
  from a request and Delete on the users screen cannot come to differ. The tombstone is the
  evidence; the request keeps the account id as proof and clears `claimedIdentity` with the
  rest, because the identity they gave when they asked is personal data too.
- **`rejected` is the protocol's word and Refused is the reader's.** The statuses mirror
  `DsrStatus` in `@idenzy/protocol/enums/compliance`, like the security screen's sample. The
  old list said `refused`, which the API never answers with, and a test pins the four.
- **An extension is reviewed, and once.** `extensionBlocker` answers all three rules: one per
  request, told to the person inside the first period, and agreed by an owner or admin other
  than the actor. A project with nobody else to ask says so rather than offering a control
  that fails.
- **The subject is searched and confirmed, never typed exactly.** `DataRequestSubjectSearch`
  shows the account whole before it is used, and a request the search cannot place is
  recorded as the person described themselves, then matched when it is verified. The old
  form needed an exact address and dropped everything else.
- **The counters are the view control.** Overdue, Due within 7 days, Open and Closed are
  toggles over the same queue, so the figure an operator arrives for is also the way into the
  rows behind it, and the heading states the finding over the rows actually shown.
- The view, the two menus and the open request are in the query, replaced rather than pushed;
  the search term is not, because an address in a URL is personal data in a browser history.

## Working on the auth domains screen

`/domains` follows `notes/domains.md`. The host in force, what the transport can do with it,
the figures, the list, then the setup behind a row.

- **An auth domain is an API host and never a page.** `auth.customer.com` is a CNAME at our
  load balancer that a customer's own React or Nuxt page sends `fetch` calls to. "You need
  an auth domain" reads as "we host your sign-in screen", which is the one thing this
  product does not do (ADR-0002), so the screen says what it is not before it asks for
  anything.
- **The capability rows are states, not refusals.** Header mode on the shared host is a
  legitimate integration; `cookieModeState` answers `Requires a custom domain` with the
  control that starts it, and reserves the unhappy words for a domain that was added and did
  not verify. "Cookie mode: Refused" over a working project reads as an incident report.
- **Verification is not migration, and the last two steps exist to say so.** A verified host
  changes no deployed base URL and makes no unrelated origin same-site. `authSetupStage`
  therefore stops at `sdk` on a verified domain and never advances itself past it, while
  `reached` lets the reader walk to the test anyway — gating the check on something we
  cannot observe would make it unreachable for exactly the domain it is for.
- **`setupProbe` is pure, and its fourth line is the point of it.** Three lines are ours to
  observe; the fourth says the named origin is on the CORS allowlist and explicitly not that
  a deployed client is calling this host. Tests pin that wording, because a green tick over
  four lines is what would hide it.
- **Every copyable endpoint is `apiBaseUrl` over the project's own domains.** One derivation
  across this screen, General, revocation and the OAuth examples; an illustrative value is
  labelled `Illustrative` rather than left to look configured.
- **A figures strip with nothing in it is still worth drawing.** Requests are not metered per
  host, so Connected applications uses `UsageTile`, which draws the faint wave and `No data`
  in words, with a line saying what is registered rather than observed.

## Working on the SMS policy screen

`/sms/policy` follows `notes/sms-policy.md`. Readiness first, then the two decisions beside
the money they cost, then the ceilings, then everything nobody configures folded away.

- **Readiness is five checks over four screens, and the badge is read off all of them.**
  `smsReadiness` in `app/utils/sms-policy.ts` is pure over what the panel already holds, so
  the answer changes the moment a setting elsewhere does: the method (`/methods/otp`), the
  carrier (`/sms/providers`), the countries and the human check (here), the balance
  (`/settings/billing`). A policy that called itself ready while the vendor transport or the
  verifier was unavailable is the one thing this screen must not say.
- **The human check is the reason the screen exists.** Attestation is on by default and
  nothing on this deployment can answer one, so a project with a perfect allowlist and a
  healthy cap still sends nothing and the refusal names a token the caller could never have
  obtained. No log says "your settings are fine and the deployment is not".
- **`Set up SMS` writes one policy; there is no `Create a policy`.** The old button made the
  row with its column defaults and left the project as unable to send as before, which is a
  database step wearing a decision's clothes. `SmsSetupDialog` asks for the countries, the
  cap and the human check and writes the row once; delivery is a step that asks nothing,
  because it is settled elsewhere and a policy is still worth writing without it.
- **The cap is a draft with its own Save, and the ceilings are dialogs.** The cap is typed,
  so saving the "2" of a "20" refuses every send until the "0" lands; the other three are
  one bounded whole number each and go through `NumberDialog`. `capChange` states the before,
  the after, and the case the note asks for by name: a cap at or below the day's spend stops
  the channel until midnight UTC, and that has to be readable before the write.
- **Never draw the spend meter without a cap.** `capShare` answers 1 for a cap of nought, so
  a project with no policy drew a full red bar at nought spent, which is the opposite of the
  truth. The meter is bound to `policy`, and the line under it says why nought there is a
  refusal rather than a quiet day.
- **Reserved is shown apart from spent.** A reservation is taken before the message goes out
  and settled against what the carrier charged; an unsettled one stands rather than being
  released, because a dispatch that threw may still have put a message on the wire. The cap
  reads the whole ledger and only the settled part is a message somebody was handed.

## Working on the sending domains screen

`/email/domains` follows `notes/email-domains.md`. The answer first, the list under it, the
selected domain's setup under that, and delivery last.

- **Verification and sending are two states and never one badge.** `verificationState` says
  where the DNS stands and `sendingState` says whether the From line is on it, with "Ready"
  between them for a verified domain nobody has selected. A provider will call an identity
  verified while the bounce route is missing, and a customer who saw one badge would believe
  their mail already carries their own name.
- **Change sender is beside the From line and nowhere else.** Verifying a domain must never
  move the sender, which is an acceptance check in the note; `SendingDomainSenderDialog` is
  the only thing that writes `inUse`, it lists every domain including the ones that cannot
  send with the reason, and it repeats the monthly charge at the point of choosing.
- **The answer is one line and three facts.** The From line leads at `text-base` mono with
  Change sender beside it, and the strip under it says where a rejection goes, whose
  reputation carries the mail and what a month costs on either domain. Everything a reader
  cannot act on from here is folded into the card at the foot; the two prose rows that used
  to sit under the From line pushed the list below the fold.
- **The setup is a dialog, and it was a block.** `SendingDomainRecordsDialog` opens over the
  list from a row's own control, capped from `lg` up and a full-height sheet below it; the
  note asked for a block under the list, and built, it pushed delivery off the fold and left
  a reader scrolling back up to change which domain they were reading. `SendingDomainSetup`
  is its body and holds one layout for both shapes: `flex-none` ends, a scrolling middle.
  Nothing opens it on arrival. `Check records` is the action until every required record
  resolves and `Send from this` is the action after; they are never both primary.
- **The domain list and the DNS records are both `RecordTable`.** One set of track widths per
  table, and the stacked arrangement below 900px comes from `data-label` rather than from a
  second grid the page and the row kept in step by hand. A cell that sets `flex` must set
  `flex-col` with it, or the `::before` the label is drawn with becomes a flex item and lands
  beside the value instead of above it.
- **The records are one table, not a group per kind.** Four headings and four paragraphs over
  five records made the setup three screens long. The kind, whether it is required and what
  the last check found are columns; the paragraph is behind an info glyph on the row, and the
  status detail is drawn only for a record that was looked for and missed.
- **Relative names are a control, not a caveat per row.** Most DNS consoles append the zone,
  and a fully qualified name pasted into one of those is a record that exists, is never found
  and is explained nowhere. `recordName` answers either form off `relativeHost` (`@` for the
  apex), a Full/Relative `SegmentedControl` picks one, and the column, its copy button and the
  sentence under the heading all follow it. Full is the default, because a console that does
  not append the zone refuses a relative name outright and that failure is the visible one.
- **Nothing in the record table truncates.** The value is the thing being compared against a
  console, so `CopyField` takes `wrap` here and the name and value break rather than clip.
  Same reason the row's own subtitle wraps: at 390px the primary cell is half the width.
- **The foot names the records outstanding, not their DNS types.** Three of the five are
  CNAMEs, so "waiting on CNAME" is a word a reader counts two answers for; `waitingOn` dedupes
  the kind labels the table itself uses.
- **Delivery says what it measured.** Sends are ours to count; delivered, bounced and
  complained are provider events, and that pipeline is unbuilt, so `deliveryFigures` answers
  null and each tile names what it would have counted. There are no reputation meters: a bar
  drawn over a fixture is the most confident thing on the page. The thresholds remain as
  reference with their provenance, and the bounce rule in the folded card agrees with the
  blocked addresses screen rather than promising a suppression that nothing writes.

## An inset inside a card is a tint of the ink, never the page's own ground

A value to copy, a consequence box, a note under a form, a glyph tile: anything set into a
card or a dialog is `bg-ink/4` with a hairline `ring-1 ring-ink/6 ring-inset`, which is the
step `SamplePanel` and Vuetify's filled field already take. `bg-canvas` is the tray under a
card (`LayerCard`, `EmptyState`, `ImportDropzone`) and the tonal band at the foot of one
(`bg-canvas/60`), and it is those two things only. A box in the canvas colour cut into a
surface reads as a hole punched in the card, and on the dark theme it is the darkest thing
on a screen whose whole point is the value inside it. The user asked for this by name over
`CopyField`, so the sweep went through every dialog and page rather than the one screen it
was noticed on.

## A dialog that writes and then closes must be mounted only while it is open

`v-if` the dialog component on the flag that opens it, as `/email/domains` does with all
four of its dialogs. Left mounted, a Vuetify dialog that closes in the same flush as a store
write leaves its teleported content painted on the page with its own model already false: it
stops answering its own Cancel, nothing in the component tree says it is open, and the only
way out is a reload. It is not the close's timing, `persistent`, or a transition, and moving
the assignment around does not help; unmounting the component takes the orphaned node with
it. Other pages here carry the same latent bug where a dialog is left mounted across a write.

## Working on the blocked addresses screen

`/email/suppressions` follows `notes/email-suppressions.md`. It is a diagnosis screen and
not a list: the operator arrives with one address from a support ticket and leaves knowing
whether mail to it can resume. The drawer, the breadcrumb and the title all say **Blocked
addresses**; suppression is the word for the records, not for the screen.

- **The list cannot be read, only asked.** `suppressions.target_hash` is a digest and no
  table holds the address, so the lookup hashes in the browser and sends sixty-four hex
  characters. `hashAddress` has to agree with `hashToken` in `@idenzy/crypto` exactly, and a
  test pins it to known digests. The digest is shown back because it is the proof of what
  left the machine, and it is the only string on the answer worth copying: the address is
  never put in the URL, in a log or on the clipboard.
- **The lookup sits on the page, not in a card.** A frame around the one control makes it a
  section among sections. Under it, the records are a heading that states the finding over a
  framed `RecordTable`, which is the sending-domains list one drawer item away: this is a
  handful of rows about one subject, not the project-wide list surface, so the reason tabs
  are the table's own and there is no pager or column menu over four columns. The users and
  sessions shape stays where a reader is working through hundreds of rows.
- **Three verdicts, and the third is why the lookup has its own type.** `LookupAnswer`
  carries what was asked, the digest, what was compared and when. A browser that cannot hash
  and a list that has not been read both answer `unavailable`, never "not blocked": an
  unread list is not an empty one.
- **"Not blocked" is only as good as the recorder behind it.** Nothing writes a row yet, so
  that verdict is drawn neutral and worded as unknown rather than green and worded as
  deliverable. `DELIVERY_CAPABILITIES` is the two halves, and `deliveryStatus` is the badge
  beside the title. Its label is two words because `PageHeader` truncates one line and a
  longer badge eats the title's own end at 390px.
- **`nextStepFor` is keyed by reason, not by verdict.** A hard bounce is repaired by
  correcting an address and a complaint by asking its owner, so one "release it" under every
  block would be the wrong advice five times out of six. The steps are written to be pasted
  into a ticket.
- **Release is conditional, and `releaseDecision` is where that lives.** A channel this
  screen does not own is refused here rather than released quietly, which is what makes the
  acceptance check visible: an email release leaves the SMS block on the same address
  standing, and the result and the dialog both say so. A provider-reported block asks for a
  typed reason instead of an acknowledgement tick, because a box records that somebody
  clicked and a sentence records why.
- **Releasing deletes the row and keeps a `ReleaseRecord`.** The decision outlives the block,
  which is the half of "do not erase the audit history" the panel can hold.
- **The successful release is its own state**, saying what was not done as well as what was:
  nothing is sent to check. It offers Ask again and Check another address rather than leaving
  the reader on a verdict that is no longer true.
- **Blocking an address by hand is not offered**, and the capability list says so. An
  operator hunting for an add button that is missing reads it as a bug rather than a gap.

## Working on the one-time codes screen

`/methods/otp` follows `notes/methods-otp.md`: the channel is the first decision, so the tabs
sit under the title and everything below them belongs to the channel on show. Email, SMS and
magic links are three integrations rather than three switches, which is the whole reason the
screen is shaped this way.

- **Readiness comes before enablement, and most of it is on other screens.** `channelChecks`
  in `app/utils/otp.ts` is pure and reads what the panel already holds, so a prerequisite
  answers the moment a setting changes elsewhere. Every row names the screen that settles it:
  the sending domain, the country allowlist, the spend cap, the delivery account, attestation,
  the CORS allowlist. A failing check is what the badge calls setup incomplete, and `Complete
  setup` goes to the first one.
- **Off is a decision and not a fault.** A channel nobody turned on says `Off` rather than
  listing what would be wrong with it, and the header badge names the channel that is on and
  stuck, because a reader on the email tab must not have to open the SMS one to find out.
- **The channel's foot is the save summary.** Every control here writes at once, so there is
  no `Save channel settings` however the note's mockup draws it; what that button was for is a
  permanent sentence stating the sign-in and sign-up behaviour and counting what is blocking.
  `notes/methods-otp.md` records the trade under "Settled while implementing".
- **What a user feels leads, and how a code is stored follows.** Expiry, wrong guesses, what
  asking again does and what a send costs are four `LifetimeOutcome` figures in a strip; the
  entropy, the hash and the single-use rule sit folded at the foot of the page.
- **A return URL is not a CORS origin, and adding one never adds the other.** The dialog shows
  the whole example, states the string the server will compare, and offers the origin as a
  separate box that is off until somebody ticks it (ADR-0006). A native scheme has no origin
  and a loopback one cannot be allowed, so neither counts against the check.
- **The tab lives in the query,** so a screen somebody is asked to look at can be linked to,
  and it is replaced rather than pushed: moving between tabs is not navigation to step back
  through.
- **WhatsApp is a tab that cannot be turned on.** It is already a name in the SDK's channel
  enum and the first thing an operator looks for after SMS, so it is findable and says what it
  is not, rather than being left out and hunted for across three screens.

## Working on the authenticator screen

`/mfa/totp` follows `notes/mfa-totp.md`. It is the screen where the panel's own words are
most likely to mislead, so most of its shape is about one sentence: available is not
required.

- **The badge says whether the method exists and the strip says who is challenged.** They
  are different questions and the second one's answer is a count, which is why
  `scopeSummary` in `app/utils/mfa.ts` writes it out with both sides in it: the accounts
  that enrolled one and are asked for a code, and the accounts that sign in with one
  factor. A green badge alone reads as "every user must enrol".
- **Requiring it of everybody is a row that says `Not yet`, never a switch.** A challenge
  in front of an account holding nothing is a sign-in that cannot be completed, so the
  requirement waits on an enrolment step inside sign-in. `MfaChallengeGate` answers null
  for a user with nothing enrolled, which is the same decision on the server.
- **The factor model is a matrix and not prose.** `challengeScenarios` is six cases in the
  reader's words with a three-word answer each, and it replaced two cards that explained
  demanding and answering in ours. Its foot carries the two things no row can: that one
  gate decides for every flow, so a sign-in method added later is challenged on the same
  terms, and that while the method is off no row applies today.
- **The name is a draft; the switch is not.** A name is typed, so it saves through Save
  name with Cancel changes beside it and the preview follows the draft. The switch is one
  state and writes at once, except off, which goes through `TotpDisableDialog` because it
  stops a code being asked for on every account that holds one and only a dialog can state
  the number.
- **Following the project's name is a choice, not a blank field.** Null carries a later
  rename of the project along and a typed name holds still, so the two are a segmented
  control and the field belongs to the second one.
- **The sample secret is behind a disclosure and labelled a sample.** A page about second
  factors that shows a secret is a page an operator reads as their own enrolment; the panel
  says so and points at Account, which is where their own authenticator lives.
- **There is no setup check, deliberately.** An authenticator needs nothing but a session,
  so unlike passkeys and one-time codes there is no prerequisite on another screen for a
  check card to go and read.

## Working on the recovery codes screen

`/mfa/recovery` follows `notes/mfa-recovery.md`. It is a support queue first and a settings
screen barely at all: find the accounts about to lose access, and hand the operator the only
safe way to fix one. `app/utils/recovery.ts` states what the server decided and reads what
it shares with the authenticator screen out of `app/utils/mfa.ts` rather than writing it
again: the count of codes, the attempt cap and the challenge's lifetime are one fact each.

- **"Sheet" is not the word, in the copy or in the code.** A customer reads recovery codes,
  so the noun for the ten of them is a *set*: `RecoverySet`, `CODE_SET`, `setsFor`,
  `clearCodes`. The rename went through the store and the user detail page on purpose,
  because a screen whose labels and source disagree drifts back.
- **The queue is the page, and it opens on the accounts with nothing left.** An account
  holding a second factor and no unspent code is a support ticket that has not happened yet.
  The other two segments carry their counts, the search covers name, email, phone and id,
  and the base order is fewest codes first so the row the detail panel opens on is the row
  at the top.
- **A row's own action is View, never Clear.** Clearing somebody's codes is not the remedy
  for somebody who has none, which was the finding this screen was rebuilt for.
  `RecoveryAccountCard` leads with what the account holds and what its owner has to do,
  written to be pasted into a ticket; invalidating what is left sits behind an Advanced
  fold. It is mounted twice, inline from `lg` up and in a full-height dialog below it.
- **There is no "generate a set for them", and there will not be.** The codes are returned
  exactly once and only digests are kept, so an operator who could regenerate would be
  handed ten working credentials for an account that is not theirs. `nextStepFor` says the
  honest thing instead: they can still sign in with the factor they hold, and if that goes
  first, nothing here can let them back in.
- **A set nobody generated and a set spent to the last code both read as zero to the
  server**, because `countUnused` is all it publishes. `remainingLabel` is the panel saying
  which is which: "Never generated" against "No codes remaining", never a bare "0 of 10".
  Both are written out beside the pips, because a bar of colour is not a state.
- **The clear dialog is two decisions with one set of mechanics.** With codes unspent it is
  `Invalidate N codes` behind an acknowledgement; with none it is `Clear spent codes` with
  the acknowledgement dropped and a line saying this restores nothing. Asking somebody to
  tick a box about a loss that already happened teaches them to tick boxes.
- **The threshold is the dashboard's, not the server's.** It decides which accounts this
  screen and the security centre flag as running low and nothing else, so it is named
  "Warning threshold" and its dialog says the server never reads it. A sign-in behaves the
  same whether an account has ten codes or one.
- **`Notify user` is shown switched off, with the reason under it.** There is no audited
  send behind it, and a queue that silently lacks the obvious action reads as a missing
  feature nobody explained. Copy instructions is what actually works.
- **The placeholder sets are derived from the users store**, seeded by user id. The accounts
  with a second factor are the accounts with codes, so two independently invented sets of
  people would disagree the moment somebody compared this screen with the users list.

## Working on the additional-verification screen

`/mfa/step-up` follows `notes/mfa-step-up.md`. The screen is called Additional verification
in the drawer, the breadcrumb and the title, with "step-up" as the first word of the
description: it is the reader's name for it, and `PageHeader` truncates one line, so a
parenthetical in the title is what a phone cuts. `app/utils/step-up.ts` holds the facts.

- **Coverage comes before the control, because a window is not enforcement.**
  `assertRecent` lets a user holding no passkey and no authenticator past, so a
  fifteen-minute window protects exactly the accounts that enrolled something.
  `stepUpCoverage` counts both sides and the strip under the tiles states the gap by name,
  above the setting rather than under it. Asking for the password instead is the honest fix
  and is not built: the screen says so and never implies otherwise.
- **`canBeChallenged` is a passkey or an authenticator, and nothing else.** That is
  `MfaFactorRegistry.forPurpose(StepUp)`, which offers those two in that order; a recovery
  code answers a sign-in and never a step-up, so an account holding only codes is an account
  that passes.
- **The matrix is the fix for one claim over four unlike rows.** `STEP_UP_ACTIONS` marks each
  as `enforced`, `sdk`, `yours` or `unavailable`, and exactly one row is `enforced`:
  `POST v1/auth/account/email` is the only route of ours that calls `assertRecent`. A test
  asserts that count, because "protected" over a mixed list overstates every row on it.
- **The security centre's challenge and a step-up are different things, and the matrix says
  so.** A detector rule answers the *sign-in* with a challenge (the MFA gate); nothing raises
  a step-up inside a session that already exists. That distinction is why the two screens
  read as disagreeing, so the row names both halves and links to the one that owns the first.
- **The window is a draft with Save beside it, not a control that writes itself.** It is
  small and reversible, so the note asks for no dialog; the footer states the before, the
  after and that it applies to the next action anybody attempts. The example under it is one
  person's afternoon rather than a table of ages: `walkthrough` returns a proof, an action
  inside the window, the same action past it and the answer that restores it, with the line
  the window draws rendered between the second step and the third. Every age comes off the
  draft and every step's freshness comes from `isProofFresh`, so the story cannot drift from
  the check it illustrates.
- **The client and server halves of the example live together, and each says what its null
  means.** A null challenge is "nothing to ask this caller for"; a null `fva` is "no proof
  can be given". Collapsing them into "allow" is how the check stops being one, so the
  server half refuses before it allows and is written against the project's own window.

## Working on the email template screens

`/email/templates` follows `notes/email-templates.md`, and it is two routes rather than
one: the catalogue at `index.vue`, and a workspace at `[type].vue` with the language in
`?lang`. The editor was a dialog and the note's first two findings are both about that.

- **It is a page because a modal is where unsaved work goes to be lost.** The workspace
  holds language management, three bodies, a preview, validation and reversion, and the
  old dialog reloaded its draft on every language change and dismissed on Escape without
  asking. The URL is durable so a reader can be sent one, and the language is a query
  parameter, replaced and not pushed: moving between languages is not navigation to step
  back through.
- **Drafts live in the store, keyed by project, message and language.** That is what makes
  them survive a language switch, a walk back to the catalogue and a return, and it is
  what lets the catalogue mark a message as holding unpublished copy. They are never
  written to browser storage: a draft is a customer's unpublished copy and a dashboard is
  opened on shared machines. The leave guard, the `beforeunload` handler and the
  catalogue's Unpublished drafts figure all read the same map.
- **Publish writes every language with unsaved copy, and is named after what it does.** A
  button that saved only the language on screen would leave the other two unpublished and
  say nothing, which is the same silent loss in a different place. `problems` therefore
  validates every dirty language, and a fault in one that is not on screen is a page-level
  strip with the way to it, because the refusal would otherwise have no visible cause.
- **Published is not sending, and both screens say which.** A body is compiled off the
  request path and the renderer reads an uncompiled row as absent, so `statusOf` answers
  `compiling` rather than `active` through that window and `localeStatusOf` marks the
  language. An operator told their new copy is theirs while our built-in is still going
  out has no other way to find out.
- **Revert shows the copy that would take over, and it is rarely the built-in.** A project
  holding `en` and `tr` that reverts `tr` sends its own English, because the project's
  whole fallback chain is tried before any copy of ours. `EmailRevertDialog` renders that
  answer; naming the wrong replacement is worse than naming none.
- **The catalogue's subject column is rendered, not source.** What is being checked at a
  glance is what lands in an inbox, so sample values are substituted and the template is a
  hover away. Its filter says Custom, Built-in and Unavailable: "Yours" and "Copy in use"
  both had to be translated by the reader before they meant anything.

### The editor

`CodeEditor.vue` is CodeMirror 6 and serves all three fields, the subject included.

- **The subject is the reason it is one component.** A subject typed in a `v-text-field`
  is the one field where a mistyped `{{ user.mail }}` is not marked, not completed and not
  explained, and it is the field most often typed from memory. `inline` is a shape, not a
  different editor: single line, no gutter, and pasted newlines folded to spaces rather
  than refused, because a paste that silently did nothing is the worse failure.
- **CodeMirror and not Monaco.** Monaco loads its language services from separate worker
  URLs and this panel is statically generated with no server and no third-party origin
  (PROJECT.md 10.3), so they have nowhere to come from; it is also unusable on a touch
  screen and the note specifies a mobile arrangement. The chunk is 191 KB gzipped and sits
  behind the route's own dynamic import, so no other screen pays for it.
- **The marks, the completion and the lint all read `scanPlaceholders`**, which is the
  validator's own reading of the grammar. Two readings would agree most of the time, and
  the field would go red with nothing under the cursor marked the rest of it.
- **Three marks, because a braced run fails in three ways.** A name in scope substitutes; a
  name out of scope throws and the mail is never sent; something that is not a placeholder
  at all is delivered to the reader exactly as typed. The last is the failure nobody
  notices until a customer forwards the mail back, which is why it is marked at all.
- **Tooltips are mounted on `.v-application`, not in the editor and not on `body`.** Every
  editor here sits in a card that clips its overflow, so a completion list left inside is
  cut off at the card's edge and the half that goes is the explanation. The application
  root rather than the body because Vuetify's theme class is on the root, and a tooltip
  above it is outside every `.v-theme--dark` rule in the panel. The rules for it are an
  unscoped block, as MetricChart's tooltip is, and **every selector carries at least two
  classes**: CodeMirror copies its generated theme classes onto the container it mounts a
  tooltip in, so its own defaults arrive as `.<generated> .cm-tooltip` and a bare class of
  ours loses however late it appears.
- **Tab is left to the browser.** `indentWithTab` traps it, and a keyboard user then cannot
  leave the field; the tidy button does the indenting better anyway.
- The colours come from `app/utils/code-theme.ts`, built from the same palette
  `app/shiki/theme.ts` gives Shiki. Two highlighters read different things (TextMate scopes
  against Lezer tags) so they cannot share a theme object; sharing the ten values under it
  is what stops a body being one set of colours in the editor and another in a code block
  beside it.

### Two things that will bite

- **`{{` in a Vue template is Vue's own interpolation.** A template literal containing it
  inside an expression is read as a mustache that never closes and the build fails with
  "Unterminated template" pointing at the line. Build the string in `<script setup>` and
  interpolate the result; `v-pre` covers the case where the braces are literal prose.
- **`EmailPreviewFrame`'s iframe is absolutely positioned, and that is a fix.** The frame is
  laid out at a real email width and scaled to fit, and a `transform` does not change an
  element's layout box: in flow, a frame a third taller than its stage grows the stage,
  which grows the frame. The pane climbs off the bottom of the page in a few frames with
  nothing in the markup to explain it.

`formatHtml` in `app/utils/html-format.ts` is the tidy behind the glyph beside HTML body.
It rewrites whitespace between tags and between attributes and nothing else, both of which
are insignificant by specification, and it repairs nothing: a formatter that closes an
unclosed tag can break a body that was rendering, and the reader pressed a button labelled
tidy. It is idempotent and there is a test that says so.

## The page notes are the specification

`notes/` holds one file per screen (`notes/methods-passwords.md`, `notes/users.md`, and
forty more), plus `notes/layout-blueprint.md`, `notes/dialogs.md` and
`notes/shared-experience.md`. **Read the page's note before changing a screen**, and read
the blueprint with it. They are proposed specifications rather than descriptions: each one
carries the desktop and mobile arrangement, the dialog order, the findings behind them and
the acceptance checks a change is judged by.

Where a note and the code disagree, the note is the target and the disagreement is usually
the finding. Two of them were about the same thing on the passwords screen: the Lifetimes
table called the password reset link deployment-fixed while the passwords screen offered a
control for it, and the strength meter's list was headed "must contain" while the policy
demands no composition at all. Both are now fixed in the direction the note names, which is
one effective policy and suggestions kept apart from requirements.

## Working on the passwords screen

`/methods/passwords` follows `notes/methods-passwords.md`: the figures under the title, the
method switch and its effect, the requirements editor beside the preview of what it makes,
reset and sessions, then the failed-attempt controls. Single column, full width, no rail.

- **Two save models on one screen, and the difference is typing.** The switches and the
  reset controls write the moment they change, because each is one discrete state. The
  requirements are a draft with `Save requirements` at the section's bottom right and
  `Cancel changes` to its left, because a minimum length is typed a digit at a time and
  saving the "1" of a "12" refuses every password on the project until the "2" lands.
- **The preview follows the draft, not the saved policy.** "What users must enter" is the
  same `requirementsOf` the SDK's error codes map to, rendered from the unsaved values, and
  it says so while they are unsaved.
- **A folded card carries its saved values in its heading.** `requirementsSummary`,
  `resetSummary` and `attemptsSummary` in `utils/password-policy.ts` are what the strip
  shows when a card is closed, so nobody has to open three cards to read the policy.
- **Two switches ask first, and each names its own number.** Turning the method off can
  strand every account holding no other credential, so `PasswordDisableDialog` states how
  many that is and what the project still offers; turning lockout on hands anybody who
  knows an address a way to lock its owner out, so `PasswordLockoutDialog` says both halves
  of that trade. Turning either back the other way asks nothing.
- **What a project cannot change is not on the screen.** The hash, the pepper and the
  normalisation moved out to the docs rather than into a card nobody can act on.

## Working on the passkeys screen

`/methods/passkeys` is a setup screen and not a settings one, and it is the model for any
method whose configuration can be right and still not work. The blocks run in one column:
what is blocking, the three things a customer decides, a check that says why a browser
would refuse a ceremony, the figures, then the WebAuthn rules folded away. No right rail,
as on passwords, one-time codes and providers: a method screen is read top to bottom and a
rail of figures beside it competes with the thing that is blocking.

- **It speaks the reader's words, and WebAuthn's only in brackets.** The rows are
  "Passkey domain (RP ID)", "Product name" and "Allowed application URLs", and the four
  dialogs use the same names. An operator who has never read the spec has to be able to
  set this up; a reviewer who has needs to know which field is the RP ID, which is what
  the bracket is for.
- **The setup check exists because two of the four things it checks are on other
  screens.** A URL that is not also on the CORS allowlist is refused by the browser with
  nothing in our logs to explain it (ADR-0006), and a project nobody has integrated looks
  exactly like one whose integration is broken. `evaluateSetup` in `app/utils/passkeys.ts`
  is pure and reads what the panel already holds, so the answer changes the moment a
  setting does and `Test setup` is a re-read rather than a request.
- **A blocker is a configuration gap, a check finding is a diagnosis.** `setupBlockers`
  answers the header badge and the strip at the top, which disappears when it is empty;
  the check card is hidden until there is a relying party, so exactly one of the two leads
  at a time.
- **A relying party is created in a dialog and never as a form on the page.** Its three
  fields are validated against each other and written as one record: an origin is only
  valid on the RP ID's domain, and a party with no origin refuses every ceremony.
- **The figures are `Statistic` tiles with one short line each.** A description that wraps
  in one tile and not the next makes four tiles read as four different objects, so what a
  figure does and does not count goes in `info` behind the glyph. No sparkline tiles here.
- **The authenticator breakdown is cards, not a chart.** A row of bars and a bar chart were
  both tried and both rejected; it is now one `Statistic`-shaped card per authenticator, the
  mark and the name as the label, the count as the figure, and where those passkeys live
  under it. The label is not `capitalize`d as the tiles above are, because CSS would turn
  iCloud Keychain into ICloud Keychain.
- **A single-colour authenticator logo is tinted, never inverted.** `Authenticator.tint`
  carries a class off the `--idenzy-mark-*` tokens in theme.css, stepped per theme like the
  platform marks beside them. Inverting a brand mark turns a blue logo white in one theme
  and black in the other, which leaves the shape doing all the work. A tint only reaches a
  mark drawn in `currentColor`, which is why Apple's is `simple-icons:apple` here and not
  `logos:apple`: the `logos` body paints a fixed black that no class can touch. Check the
  collection before assuming a colour class will land.

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
  for the account, a passkey and a recovery code only answer a challenge something else
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
