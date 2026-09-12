import tailwindcss from "@tailwindcss/vite";
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

  // Only publishable keys ever reach this bundle.
  runtimeConfig: { public: { idenzyPublishableKey: "", authApiBaseUrl: "" } },

  modules: [
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
       * Ripple is off everywhere rather than per component. It is a Material signature
       * and reads as one, and a panel this dense shows the animation more often than it
       * shows the thing the animation was meant to confirm. Hover, focus and pressed
       * states carry that on their own.
       */
      defaults: { global: { ripple: false } },

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
           * `primary-sharp` is the ground of the one lit button (FancyButton): deeper
           * and more saturated than either, because that button carries a wash of white
           * that brings it back up, and it is the same in both themes so the one call
           * to action looks the same wherever it is met.
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
