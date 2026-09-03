import { SessionTransport } from "@idenzy/protocol/http/headers";
import { ApiKeyPrefix, isPublishableKey, isSecretKey } from "@idenzy/protocol/schemas/common";
import { IdenzyConfigurationError } from "./errors.js";
import type { FetchLike } from "./http/transport.js";

/** Loopback, where a browser treats http as secure and a developer has no certificate. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export interface IdenzyOptions {
  /** The project's publishable key. Meant to sit in a browser bundle; a secret key is not. */
  readonly publishableKey: string;
  /** The auth API this project answers on: a custom auth domain, or ours in development. */
  readonly apiUrl: string;
  /**
   * How the session is carried. Header mode works everywhere and is the default; cookie
   * mode needs a custom auth domain, and asking for it elsewhere is refused by the server
   * rather than granted and silently dropped (PROJECT.md 4.3).
   */
  readonly sessionTransport?: SessionTransport;
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
    readonly sessionTransport: SessionTransport,
  ) {}

  static parse(options: IdenzyOptions): IdenzyConfig {
    return new IdenzyConfig(
      assertPublishable(options.publishableKey),
      assertSecureUrl(options.apiUrl),
      options.sessionTransport ?? SessionTransport.Header,
    );
  }

  /** True where the browser attaches cookies for us and the CSRF header has to be echoed. */
  get usesCookies(): boolean {
    return this.sessionTransport === SessionTransport.Cookie;
  }

  /** Absolute, and resolved against a base that always ends in a slash. */
  urlFor(path: string): string {
    return new URL(path, this.apiUrl).toString();
  }
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
