import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

/**
 * One `.env` for the whole repository, the way every other service reads it.
 *
 * Loaded here rather than through Nuxt's own `dotenv` option, which resolves against this
 * app's directory and reads the file before this config is evaluated — so neither
 * `fileName` nor `cwd` can point it one level up. A second `.env` beside this file would
 * be a copy of values the APIs already have, and a copy is a thing that drifts.
 *
 * Absent is not an error: CI and production set real variables and have no file. Only
 * `NUXT_PUBLIC_*` from it reaches the browser, which is the same boundary as always.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No file, which is the normal case everywhere but a laptop.
}

import { IDENZY_CODE_DARK, IDENZY_CODE_LIGHT } from "./app/shiki/theme";

/**
 * Customer dashboard (PROJECT.md 10.1).
 *
 * SSR off, deliberately. This panel is behind authentication and invisible to crawlers,
 * so server rendering would buy nothing while adding a server that holds customer
 * session material. As a static SPA it cannot leak one tenant's data into another's
 * rendered HTML, because no rendering happens on our servers at all.
 *
 * It authenticates with our own product through the headless SDK, which is the most
 * honest test of the headless claim: if it is painful here, it is painful for customers.
 */
export default defineNuxtConfig({
  ssr: false,

  compatibilityDate: "2026-09-01",
  typescript: { strict: true, typeCheck: false },

  /**
   * How the panel signs in to our own product (PROJECT.md 9.5).
   *
   * `@idenzy/nuxt` writes these into `runtimeConfig.public.idenzy`, so the environment
   * overrides them as `NUXT_PUBLIC_IDENZY_*` without a rebuild. Both values are public by
   * construction: a publishable key is meant to sit in a browser bundle, and the auth
   * API's URL is printed in every token we sign. Nothing secret is configured here, and
   * the module's `server` half — the one place a secret could go — is deliberately absent,
   * because `ssr: false` means there is no server of ours to hold one.
   *
   * `sessionTransport` is left at its default of `auto`, which asks for cookie mode and
   * accepts the server's answer. Cookie mode is the one where the refresh token is a
   * `__Host-` HttpOnly cookie no script can read (ADR-0008), and it is available to us
   * because we control our own DNS: `app.idenzy.io` to `auth.idenzy.io` is same-site.
   * On a laptop everything is loopback, which is same-site by accident and is the
   * documented development exception.
   */
  idenzy: {
    publishableKey: "",
    apiUrl: "http://localhost:3001",
  },

  modules: [
    "@idenzy/nuxt",
    "vuetify-nuxt-module",
    "@vueuse/nuxt",
    "nuxt-echarts",
    "@pinia/nuxt",
    "@nuxt/icon",
    "nuxt-shiki",
  ],

  css: ["~/assets/css/main.css", "~/assets/css/theme.css"],

  /**
   * Every icon in the panel, including the ones Vuetify draws for itself. See
   * app/icons/material-symbols.ts for how the two are joined.
   *
   * Three of these four settings exist to keep the panel off the network. The module's
   * defaults reach for api.iconify.design when an icon is not bundled, and PROJECT.md
   * 10.3 allows no third-party origin here; `serverBundle` is moot in any case, because
   * a statically generated SPA has no server to answer its own endpoint. So the icons
   * are compiled in, and one that was not compiled in renders as nothing rather than as
   * a request.
   *
   * `mode: "svg"` over the default `css` for the same reason: CSS mode injects a style
   * element at runtime, which a strict `style-src` refuses.
   */
  icon: {
    mode: "svg",
    provider: "none",
    fallbackToApi: false,
    serverBundle: false,
    // .ts is not scanned by default, and the Vuetify alias map is a .ts file.
    clientBundle: { scan: { globInclude: ["app/**/*.{vue,ts}"] } },
  },

  /**
   * Syntax highlighting, for the token preview on the claims screen and for the payload
   * and snippet views that follow it.
   *
   * `bundledThemes` is empty and that is the point. The module can only import themes
   * Shiki ships, and none of them is this panel: the pair in app/shiki/theme.ts is built
   * from our own palette and handed straight to `codeToHtml`, which accepts a theme
   * object and registers it on first use. Shiki still writes its own default into the
   * generated options as `theme: "min-dark"`; a `themes` pair always wins over it and
   * nothing imports it, so it is inert rather than a setting.
   *
   * `defaultColor: false` is what makes the block theme-aware. Both themes are rendered
   * and each token carries `--idenzy-code-light` and `--idenzy-code-dark`; theme.css
   * picks between them off Vuetify's own theme class, the same way every other pair of
   * values in this panel does. A single theme baked into the markup would be the one
   * thing on the screen that does not follow the reader's choice.
   *
   * Languages are declared rather than dynamic, for the same reason the icons are: a
   * grammar fetched on demand is a request to a CDN, and PROJECT.md 10.3 allows no
   * third-party origin here. A language not on this list is a line to add.
   */
  shiki: {
    bundledLangs: ["json", "typescript"],
    bundledThemes: [],
    defaultLang: "json",
    highlightOptions: {
      themes: { light: IDENZY_CODE_LIGHT, dark: IDENZY_CODE_DARK },
      defaultColor: false,
      cssVariablePrefix: "--idenzy-code-",
    },
  },

  // Tailwind 4 is a Vite plugin rather than a Nuxt module: @nuxtjs/tailwindcss is still
  // on the v3 engine. What it scans is declared in assets/css/main.css.
  vite: { plugins: [tailwindcss()] },

  vuetify: {
    moduleOptions: {
      /**
       * Vuetify's `useLayout` and Nuxt's are different functions with one name, and
       * whichever loses is silently unavailable. Nuxt's built-in keeps the name because
       * it is the framework we are inside; Vuetify's is reachable as `useVLayout`.
       */
      prefixComposables: ["useLayout"],

      /**
       * Vuetify's own utility classes are 236 KB of the 296 KB it would otherwise add,
       * and a good number of them collide by name with Tailwind's. Switching them off
       * leaves one utility system in the panel instead of two that disagree about what
       * `text-center` means. Vuetify 4 only: 3.x has no individual style entry points.
       *
       * Nothing inside Vuetify depends on them. Component styles are imported per
       * component by the loader and reference their own classes only.
       */
      styles: { utilities: false },

      /**
       * The module's rules plugin does not build against Vuetify 4. It imports
       * `createRulesPlugin` from `vuetify/labs/rules`, and rules graduated to the root
       * export in 4.0, so the path no longer resolves and the bundle fails outright.
       * Turning it off costs us `useRules`; a form that wants it can call
       * `createRulesPlugin` from `vuetify` directly. Revisit when the module leaves RC.
       */
      enableRules: false,
    },
    vuetifyOptions: {
      /**
       * "custom" is the only value that makes the module leave `icons` alone: every
       * other one has it write a build-time configuration over whatever we set. The set
       * itself is Material Symbols and is installed by app/plugins/vuetify-icons.ts,
       * because an icon set is a component and this file is serialised.
       *
       * It also means no CDN link is emitted. The module reaches for jsDelivr or Google
       * Fonts for its built-in font sets, and PROJECT.md 10.3 allows no third-party
       * origin on this panel at all.
       */
      icons: { defaultSet: "custom" },

      /**
       * The one labs component the panel uses: the chart range on /usage is picked on a
       * calendar, and `VDateRangePicker` is the only thing that draws two months as one
       * control. Named rather than `true`, because `true` pulls every lab component into
       * the bundle and the rest of the panel wants none of them.
       */
      labComponents: ["VDateRangePicker"],

      /**
       * A date picker needs a date adapter, and the module only includes the composables
       * for one when this is set. Vuetify's own adapter works on the native `Date`, which
       * is what every figure on /usage is already keyed by; a library adapter would add a
       * dependency for a single control.
       */
      date: { adapter: "vuetify" },

      /**
       * Ripple is on everywhere rather than per component, and it was off for years.
       *
       * The argument for off was that it is a Material signature, and that a panel this
       * dense shows the animation more often than it shows the thing it was meant to
       * confirm: hover, focus and pressed carried that on their own. That held while an
       * action was a filled or outlined box, which has a fill and an edge to change.
       *
       * Every action in the panel is a text button now. A text button has nothing of its
       * own to change under a finger, and on a touch screen the hover overlay is all that
       * is left — which outlives the finger that caused it and reads as a stuck selection.
       * The signed-out screens reached this first and turned it back on for themselves
       * (the `v-defaults-provider` that used to be in layouts/auth.vue); this is that same
       * finding, once, for the whole product.
       */
      defaults: { global: { ripple: true } },

      theme: {
        // Vuetify 4 follows prefers-color-scheme itself, so no watcher of ours can
        // disagree with it. Colours are placeholders until @idenzy/ui owns the tokens.
        defaultTheme: "system",
        themes: {
          /**
           * Three surfaces. `shell` is the drawer and the app bar, `background` the page
           * they frame, `surface` a card on the page. In the dark theme each is a step
           * lighter than the last, so a card reads as raised and the chrome as recessed.
           * The light theme puts the page a shade off white and the chrome and the cards
           * on white, so the page is the one recessed thing and everything set on it or
           * around it is lit the same.
           *
           * The line is one opaque colour rather than a tint of the ink, so a card's
           * edge, a menu's edge and a divider are the same pixel wherever they meet
           * and none of them darkens over a fill. `border-color` and `border-opacity`
           * are Vuetify's own variables, read by everything it draws an edge on. The
           * shell's own edges are the one exception and take a quieter line, declared
           * in theme.css beside the reason.
           *
           * Material Blue A400 and A200: the accent pair, one step apart so the dark
           * theme's fill sits off a dark surface without becoming a second colour.
           * `primary-sharp` was the ground of the one lit button, deeper and more
           * saturated than either because that button carried a wash of white over it.
           * That button is gone — every action in the panel is a text button now — and
           * the colour is kept rather than deleted because it is the one saturated blue
           * the palette has, and the next thing that needs to be pressed harder than
           * text wants it rather than a sixth hex somebody picks again.
           *
           * `neutral` is the ink for a control that carries no accent, a step in from
           * pure black and pure white so an outlined button does not out-contrast the
           * heading above it. It is a theme colour rather than a palette name on the
           * component, because `grey-darken-4` means one fixed value in both themes and
           * a near-black label on a near-black surface is the half of that nobody sees
           * until they switch.
           *
           * The three outcome colours are Material's 800s on the light theme and 400s
           * on the dark, in place of the 500s Vuetify ships. A 500 green on white is
           * under 3:1, which is readable as a heading and not as the 12px trend beside
           * a figure, and the same colour marks both. Down two steps for text on white,
           * up one for text on near-black; the hue is unchanged in each case.
           *
           * `chart-1` to `chart-6` are the series colours a chart assigns in order,
           * read through `useMetricPalette`. The first is the accent, so a chart of one
           * series is drawn in the panel's own colour; the rest are stepped for each
           * surface and the order is not cosmetic: adjacent pairs were checked for
           * separation under simulated colour-vision deficiency and reordering them
           * undoes that. Three light slots sit under 3:1 on white, which is why every
           * chart has a table view and no series is told apart by colour alone. The
           * outcome colours stay out of this list: a series that means good or bad
           * wears those, and a series that is merely fourth must not.
           *
           * `flow-primary`/`on-flow-primary` are neutral-950/neutral-50 (Tailwind's
           * scale), swapped per theme so the pair is always near-black on near-white or
           * the reverse. Nothing reads them by name: `.flow-shell` in theme.css points
           * `--v-theme-primary` and `--v-theme-on-primary` at them, which is what makes
           * a flow's one accent ink instead of the panel's blue without a second copy of
           * every `color="primary"` on those screens.
           *
           * Named for the flow and not for the sign-in it started on. Two shells carry
           * it now — signing in, and creating a first project — and a person meets both
           * within a minute, so the ink is the identity of the whole first run rather
           * than a property of being signed out.
           */
          light: {
            dark: false,
            colors: {
              background: "#fafafa",
              surface: "#ffffff",
              shell: "#ffffff",
              primary: "#2979ff",
              "primary-sharp": "#0162ec",
              neutral: "#212121",
              "flow-primary": "#0a0a0a",
              "on-flow-primary": "#fafafa",
              success: "#2e7d32",
              warning: "#ef6c00",
              error: "#c62828",
              "chart-1": "#2979ff",
              "chart-2": "#eb6834",
              "chart-3": "#1baf7a",
              "chart-4": "#eda100",
              "chart-5": "#e87ba4",
              "chart-6": "#4a3aa7",
            },
            variables: { "border-color": "#e4e4e3", "border-opacity": 1 },
          },
          dark: {
            dark: true,
            colors: {
              background: "#151515",
              surface: "#20201f",
              shell: "#111111",
              primary: "#448aff",
              "primary-sharp": "#0162ec",
              neutral: "#f5f5f5",
              "flow-primary": "#fafafa",
              "on-flow-primary": "#0a0a0a",
              success: "#66bb6a",
              warning: "#ffa726",
              error: "#ef5350",
              "chart-1": "#448aff",
              "chart-2": "#d95926",
              "chart-3": "#199e70",
              "chart-4": "#c98500",
              "chart-5": "#d55181",
              "chart-6": "#9085e9",
            },
            variables: { "border-color": "#363635", "border-opacity": 1 },
          },
        },
      },
    },
  },

  /**
   * Registered explicitly so the bundle carries the chart types this panel draws and
   * nothing else. ECharts imports its whole catalogue otherwise, which is roughly a
   * megabyte for the four charts on a usage page.
   */
  echarts: {
    renderer: "canvas",
    charts: ["BarChart", "LineChart", "PieChart"],
    components: [
      "DatasetComponent",
      "GridComponent",
      "LegendComponent",
      "TitleComponent",
      "TooltipComponent",
    ],
  },
});
