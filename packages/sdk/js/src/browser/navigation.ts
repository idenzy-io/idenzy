import { IdenzyConfigurationError } from "../errors.js";

/**
 * Sends the browser somewhere else.
 *
 * A port rather than a direct `location.assign`, because the call is the last thing that
 * happens on the page and a test that made it would end the test. It is also the seam a
 * React Native or Electron host replaces, where "navigate" means opening a system browser
 * rather than replacing the document.
 */
export interface Navigation {
  assign(url: string): void;
  /** The current URL, or null where there is no document. */
  current(): string | null;
}

/** The browser's own. Replacing rather than pushing, so the flow leaves no history entry. */
export class WindowNavigation implements Navigation {
  assign(url: string): void {
    const location = globalThis.location;
    if (location === undefined) {
      throw new IdenzyConfigurationError(
        "There is no browser to navigate. Ask for the authorization URL instead and send the user there yourself.",
      );
    }
    location.assign(url);
  }

  current(): string | null {
    return globalThis.location?.href ?? null;
  }
}
