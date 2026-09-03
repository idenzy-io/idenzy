/** Keeps the PKCE verifier across the redirect to the provider and back. */
export interface PkceStore {
  save(verifier: string): void;
  /** Reads and removes in one step: a verifier is single use, and a second read is a bug. */
  take(): string | null;
}

const KEY = "idenzy.oauth.verifier";

/**
 * `sessionStorage`, which is the opposite decision from the refresh token and for a reason
 * that does not generalise.
 *
 * A refresh token stays out of web storage because it mints tokens for as long as the session
 * lives, and memory costs only a page reload. A verifier has no such option: the whole flow
 * is a full-page redirect to another origin and back, so memory is guaranteed to be gone by
 * the time it is needed. What makes storing it sound is what it is worth, which is nothing on
 * its own. It is single use, minutes long, and useless without the code it is paired with,
 * and the code is only ever handed to the registered redirect URI.
 *
 * `sessionStorage` throws rather than returns null where a browser refuses site data, so
 * every access is guarded and falls back to memory. That fallback loses a redirect flow in
 * the rare browser that does it, which is a visible failure rather than a silent downgrade.
 */
export class SessionStoragePkceStore implements PkceStore {
  private fallback: string | null = null;

  save(verifier: string): void {
    this.fallback = verifier;
    try {
      globalThis.sessionStorage?.setItem(KEY, verifier);
    } catch {
      // Site data is refused. The in-memory copy is all there is, and it survives everything
      // except the redirect this exists for.
    }
  }

  take(): string | null {
    const held = this.fallback;
    this.fallback = null;
    try {
      const stored = globalThis.sessionStorage?.getItem(KEY) ?? null;
      globalThis.sessionStorage?.removeItem(KEY);
      return stored ?? held;
    } catch {
      return held;
    }
  }
}
