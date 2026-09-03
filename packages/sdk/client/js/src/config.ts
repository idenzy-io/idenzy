import { ApiKeyPrefix, isPublishableKey, isSecretKey } from "@idenzy/protocol/schemas/common";
import { IdenzyConfigurationError } from "./errors.js";
import type { FetchLike } from "./http/transport.js";
import type { SessionTransportPreference } from "./http/transport-mode.js";

/** Loopback, where a browser treats http as secure and a developer has no certificate. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface IdenzyOptions {
  /** The project's publishable key. Meant to sit in a browser bundle; a secret key is not. */
  readonly publishableKey: string;
  /** The auth API this project answers on: a custom auth domain, or ours in development. */
  readonly apiUrl: string;
  /**
   * How the session is carried, and `auto` is the default worth keeping.
   *
   * Cookie mode is better and needs a custom auth domain, which the client cannot detect from
   * its own URL: a custom domain is a CNAME and looks like any other host from here. So `auto`
   * asks for cookie mode and steps down to header mode if the server says it cannot work.
   * Naming a mode explicitly disables that, in both directions (PROJECT.md 4.3).
   */
  readonly sessionTransport?: SessionTransportPreference;
  /**
   * What to call this device in the user's own session list, for a "your devices" screen.
   *
   * Sent only where a session is created, and nothing on the server reads it for anything but
   * display. Leave it unset and the row is unnamed, which is honest: the alternative is
   * guessing from a user agent string, and a wrong guess is worse than a blank.
   */
  readonly deviceName?: string;
  /** A substitute `fetch`, for a proxy, tracing, or a runtime without a global one. */
  readonly fetch?: FetchLike;
}

/**
 * The client's settings, validated once at construction (PROJECT.md 7.2.9).
 *
 * Both checks here refuse something that would otherwise work. A secret key in a browser
 * bundle authenticates every request perfectly until somebody reads the bundle, and the
 * server's own refusal happens on our side of the network, after the key has already been
 * published. Plain http to a real host likewise carries the key and every token in clear
 * while looking, to the developer, exactly like the working thing.
 */
export class IdenzyConfig {
  private constructor(
    readonly publishableKey: string,
    readonly apiUrl: URL,
    readonly sessionTransport: SessionTransportPreference,
    readonly deviceName: string | null,
  ) {}

  static parse(options: IdenzyOptions): IdenzyConfig {
    return new IdenzyConfig(
      assertPublishable(options.publishableKey),
      assertSecureUrl(options.apiUrl),
      options.sessionTransport ?? "auto",
      deviceName(options.deviceName),
    );
  }

  /** Absolute, and resolved against a base that always ends in a slash. */
  urlFor(path: string): string {
    return new URL(path, this.apiUrl).toString();
  }
}

/**
 * A blank name is no name, and 200 is what the server stores.
 *
 * Truncating here rather than letting the server do it keeps a long name from riding on every
 * sign-in request only to be cut on arrival. A name is never a reason to refuse a
 * configuration, so nothing throws.
 */
function deviceName(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed.slice(0, 200);
}

function assertPublishable(key: string): string {
  if (isSecretKey(key)) {
    throw new IdenzyConfigurationError(
      `A secret key was passed to a client SDK. Use the ${ApiKeyPrefix.Publishable} key: an ${ApiKeyPrefix.Secret} key must never leave a server.`,
    );
  }
  if (!isPublishableKey(key)) {
    throw new IdenzyConfigurationError(
      `publishableKey must start with ${ApiKeyPrefix.Publishable}.`,
    );
  }
  return key;
}

function assertSecureUrl(apiUrl: string): URL {
  let url: URL;
  try {
    // A trailing slash so every path resolves relative to the whole base. Without it, a
    // base of https://auth.example.com/api would drop `/api` from every request.
    url = new URL(apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  } catch (error: unknown) {
    throw new IdenzyConfigurationError(`apiUrl is not a URL: ${apiUrl}`, { cause: error });
  }
  if (url.protocol !== "https:" && !LOOPBACK.has(url.hostname)) {
    throw new IdenzyConfigurationError(`apiUrl must be https outside loopback: ${apiUrl}`);
  }
  return url;
}
