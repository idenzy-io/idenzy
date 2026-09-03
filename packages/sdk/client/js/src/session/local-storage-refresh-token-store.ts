import type { RefreshTokenStore } from "./refresh-token-store.js";

/**
 * A refresh token in `localStorage`, which is a downgrade and is here anyway (ADR-0008).
 *
 * What it costs: every script on the origin can read this, including one that arrived through
 * a dependency nobody reviewed, and what it grants is not a request or two but a mint for
 * access tokens as long as the session lives. Rotation makes that theft detectable, not
 * preventable, and the detection lands on the next legitimate use, by which time the attacker
 * has had a valid session and the victim's reward is being signed out of every device.
 *
 * Why it exists nonetheless: without it every customer who needs a session to survive a reload
 * writes this class themselves, and theirs forgets to clear on sign-out, or shares one key
 * across two projects. Shipping it is not the recommendation. Cookie mode is, and it is
 * strictly better than this: the token outlives the tab there too and script cannot read it at
 * all.
 *
 * ```ts
 * new Idenzy(options, { refreshTokens: new LocalStorageRefreshTokenStore(options.publishableKey) })
 * ```
 */
export class LocalStorageRefreshTokenStore implements RefreshTokenStore {
  private readonly key: string;
  /** Survives a browser that refuses site data, where every call below throws. */
  private fallback: string | null = null;

  /**
   * `scope` namespaces the entry, and the publishable key is the value to pass. Two projects
   * on one origin must not share a slot, and a rotated key should orphan the old token rather
   * than resume a session against a project that no longer matches it.
   */
  constructor(scope: string) {
    this.key = `idenzy.refresh.${scope}`;
  }

  read(): string | null {
    try {
      return globalThis.localStorage?.getItem(this.key) ?? this.fallback;
    } catch {
      return this.fallback;
    }
  }

  write(token: string): void {
    this.fallback = token;
    try {
      globalThis.localStorage?.setItem(this.key, token);
    } catch {
      // Private mode, or site data refused. The session still works for this tab.
    }
  }

  clear(): void {
    this.fallback = null;
    try {
      globalThis.localStorage?.removeItem(this.key);
    } catch {
      // Nothing to do, and nothing that should stop a sign-out from completing.
    }
  }
}
