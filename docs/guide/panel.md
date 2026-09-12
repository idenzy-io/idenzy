# The client panel

`apps/client`, its stack, and the conventions every screen in it inherits. The per-screen
rules are in [panel-screens.md](./panel-screens.md); the specifications are in `notes/`.

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

## The stack

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

## An inset inside a card is a tint of the ink, never the page's own ground

A value to copy, a consequence box, a note under a form, a glyph tile: anything set into a
card or a dialog is `bg-ink/4` with a hairline `ring-1 ring-ink/6 ring-inset`, which is the
step `SamplePanel` and Vuetify's filled field already take. `bg-canvas` is the tray under a
card (`LayerCard`, `EmptyState`) and the sticky toolbar that floats over the page itself
(`bg-canvas/85` with a blur), and it is those two things only. A tonal band inside a card,
at its head or its foot, is `bg-ink/3`: it used to be `bg-canvas/60`, which on the light
theme was a faint wash and on the dark one was the darkest thing in the card. A box in the canvas colour cut into a
surface reads as a hole punched in the card, and on the dark theme it is the darkest thing
on a screen whose whole point is the value inside it. The user asked for this by name over
`CopyField`, so the sweep went through every dialog and page rather than the one screen it
was noticed on. The file-progress box in `ImportDropzone` was the last one left, noticed
in the import wizard on the dark theme.

## A field a person types into carries no `density`

`theme.css` maps the three densities onto the control scale, and `compact` is the
**x-small** step: 24px. That is a height for a chip, and on a `v-text-field` it is a box
shorter than the 13px line inside it, which is what the squashed inputs on "Change your
address" and "Rename this project" were. A form field in a dialog or a card states no
density at all and takes the 40px default, as `OriginAddDialog`, `UserAddDialog` and the
daily-cap field on `/sms/policy` always did; the stray `compact` on nine of them was the
outlier rather than the convention, so the sweep took all nine.

The one exception is a toolbar search box, which has to line up with the `size="small"`
buttons beside it: those carry `density="comfortable"`, the 32px step, and scoped CSS for
the 0.75rem type and the small radius that make the row read as one set.
`.users__search`, `.members__search` and `.routes__search` are the same rule three times.

**Set the height as a density and never as a property in scoped CSS.** The comment on
`.suppressions__field` in `/email/suppressions` is the long version and was written the
first time this bit: `theme.css` sets `--v-input-control-height` on the input root *and* on
the field because Vuetify redeclares it per variant, and the control's box is sized from
the root, so a height overriding only the field's copy grows the text's box past the border
it sits in. Pinning 32px on `.v-field` while leaving `compact` on the component puts a 32px
field inside a 24px control, which is the overflowing name field reported on
`/settings/account` and was the same latent break in the routes toolbar on `/sms/providers`.
The density is the only lever that reaches both elements. A few toolbars still carry the
redundant pin next to a `comfortable` that already says 32px; they render correctly and are
a tidy-up, not a bug.

`v-checkbox-btn` is not caught by any of this: it renders a bare `v-selection-control`
with no `v-input` wrapper, so `.v-input--density-compact` never matches it and its
`density="compact"` is doing something else entirely. `v-switch` does carry the wrapper,
but `theme.css` pins the inset track at 20px, so its density is inert too. Both are left
alone.

## A dialog that writes and then closes must be mounted only while it is open

`v-if` the dialog component on the flag that opens it, as `/email/domains` does with all
four of its dialogs. Left mounted, a Vuetify dialog that closes in the same flush as a store
write leaves its teleported content painted on the page with its own model already false: it
stops answering its own Cancel, nothing in the component tree says it is open, and the only
way out is a reload. It is not the close's timing, `persistent`, or a transition, and moving
the assignment around does not help; unmounting the component takes the orphaned node with
it. Other pages here carry the same latent bug where a dialog is left mounted across a write.

