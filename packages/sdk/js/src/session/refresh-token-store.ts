/**
 * Where the refresh token lives in header mode.
 *
 * In cookie mode there is nothing to keep: the browser holds a `__Host-` cookie that
 * JavaScript cannot read, which is the whole point of that mode.
 */
export interface RefreshTokenStore {
  read(): string | null;
  write(token: string): void;
  clear(): void;
}

/**
 * The default, and the reason it is memory and not `localStorage`.
 *
 * A refresh token in web storage is readable by every script on the origin, including one
 * that arrived through a dependency, and it is the credential that mints tokens for as long
 * as the session lives. So the default costs a page reload rather than a compromise: on the
 * web the answer is cookie mode, where the token is `HttpOnly` and outlives the tab without
 * ever being reachable by script.
 *
 * A customer who needs header mode to survive a reload substitutes their own store, and on
 * mobile that is the right seam: Keychain and Keystore are exactly the storage this interface
 * is shaped for (PROJECT.md 4.4).
 */
export class MemoryRefreshTokenStore implements RefreshTokenStore {
  private token: string | null = null;

  read(): string | null {
    return this.token;
  }

  write(token: string): void {
    this.token = token;
  }

  clear(): void {
    this.token = null;
  }
}
