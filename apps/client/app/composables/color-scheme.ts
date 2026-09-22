/**
 * Which of the two themes the panel is drawn in, and the switch that changes it.
 *
 * `useDark` rather than a ref of our own, because the part worth not rewriting is the
 * start of it: the preference is `auto` until somebody chooses, and while it is `auto` it
 * follows `prefers-color-scheme`. That is what `defaultTheme: "system"` did alone
 * (nuxt.config.ts), and it is also the reason nobody could pick the other theme — Vuetify
 * followed the operating system and there was nothing that could disagree with it. The
 * choice is held here, and app.vue is the one place it reaches Vuetify.
 *
 * Per browser rather than per account, the way the collapsed rail is (layouts/default.vue):
 * which colour a screen is comfortable in is a fact about the screen, and a preference the
 * server carried would follow a person onto a machine where every other window is the
 * other one.
 *
 * Shared, so the control in the app bar and the binding in app.vue read one ref. Two
 * `useDark` calls each hold their own and agree only through the storage event the second
 * writes, which is a trip out through the DOM to settle something this tab already knows.
 */
export const useColorScheme = createSharedComposable(() => {
  const isDark = useDark({
    // Namespaced the way every other key this panel owns is. VueUse's default is
    // `vueuse-color-scheme`, which says nothing about whose preference it is.
    storageKey: "idenzy.theme",

    /*
     * The default handler puts a class on `<html>`, and nothing here would read it.
     * Vuetify already writes `v-theme--light`/`v-theme--dark` on the application root and
     * `color-scheme` on `:root` — the first is what theme.css scopes off, the second is
     * what the browser reads for a scrollbar and a native control — so a second mark on a
     * second element is one more thing that can be true while the panel is drawn in the
     * other theme. Replaced by nothing rather than configured, because the class is the
     * whole of what the default handler does.
     */
    onChanged: () => {},
  });

  return { isDark, toggle: useToggle(isDark) };
});
