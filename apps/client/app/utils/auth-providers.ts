/**
 * The identity providers the panel offers, in the order they are shown.
 *
 * Shared by sign-in and sign-up because they are the same list: a provider button
 * creates the account on first use and signs in on every one after, so two copies would
 * only ever be a chance for them to disagree.
 *
 * Icon names are written out in full. `@nuxt/icon` bundles what it finds by scanning the
 * source, and `app/**\/*.ts` is in that scan, so a literal here is compiled in and a name
 * assembled at runtime would draw nothing and report nothing.
 */
export interface AuthProvider {
  id: string;
  label: string;
  icon: string;
  /**
   * True for a mark that is solid black and would vanish on a dark surface. Inverting is
   * keyed off Vuetify's theme class rather than a media query, so it still agrees with
   * the panel once a manual theme toggle exists.
   */
  monochrome: boolean;
}

export const AUTH_PROVIDERS: readonly AuthProvider[] = [
  { id: "google", label: "Google", icon: "logos:google-icon", monochrome: false },
  { id: "apple", label: "Apple", icon: "logos:apple", monochrome: true },
  { id: "microsoft", label: "Microsoft", icon: "logos:microsoft-icon", monochrome: false },
  { id: "github", label: "GitHub", icon: "logos:github-icon", monochrome: true },
];
