/** The language every project falls back to when nothing closer exists. */
export const DEFAULT_LOCALE = "en";

const LOCALE = /^([a-z]{2,3})(?:[-_]([a-z]{2}|\d{3}))?$/i;

/**
 * Normalizes a locale tag, or rejects it.
 *
 * Returns null rather than throwing, because the locale usually arrives from an
 * `Accept-Language` header, and a malformed one should quietly become the default
 * instead of failing a sign-in.
 */
export function normalizeLocale(locale: string): string | null {
  const match = LOCALE.exec(locale.trim());
  if (match === null) return null;
  const language = (match[1] ?? "").toLowerCase();
  const region = match[2];
  return region === undefined ? language : `${language}-${region.toUpperCase()}`;
}

/**
 * The lookup order for a locale: `tr-TR`, then `tr`, then `en` (PROJECT.md 11.3).
 *
 * A chain rather than an exact match, so a customer who has translated `tr` gets it for
 * every Turkish region without maintaining `tr-TR` and `tr-CY` separately.
 */
export function localeChain(locale: string, fallback: string = DEFAULT_LOCALE): readonly string[] {
  const chain: string[] = [];
  const normalized = normalizeLocale(locale);
  if (normalized !== null) {
    chain.push(normalized);
    const language = normalized.split("-")[0];
    if (language !== undefined && language !== normalized) chain.push(language);
  }
  if (!chain.includes(fallback)) chain.push(fallback);
  return chain;
}
