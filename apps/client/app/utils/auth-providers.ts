/**
 * The identity providers the panel offers on its own sign-in screens, in the order they
 * are shown.
 *
 * Shared by sign-in and sign-up because they are the same list: a provider button
 * creates the account on first use and signs in on every one after, so two copies would
 * only ever be a chance for them to disagree.
 *
 * The marks come from the provider catalogue rather than being written again here. That
 * file is what the providers screen draws a customer's project from, and a Google that
 * looked one way on our sign-in screen and another on theirs would be one mark too many.
 * What this list decides is which four we ourselves offer.
 */
import { type ProviderName, providerInfo } from "./providers";

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

/** The four we sign into our own panel with. */
const OFFERED: readonly ProviderName[] = ["google", "apple", "microsoft", "github"];

export const AUTH_PROVIDERS: readonly AuthProvider[] = OFFERED.map((id) => {
  const provider = providerInfo(id);
  return {
    id: provider.id,
    label: provider.label,
    icon: provider.icon,
    monochrome: provider.monochrome,
  };
});
