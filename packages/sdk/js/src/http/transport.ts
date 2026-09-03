import { IdenzyTransportError } from "../errors.js";

export interface ApiRequest {
  readonly url: string;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly headers: Readonly<Record<string, string>>;
  /** Already serialised. The client owns the encoding, the transport only sends bytes. */
  readonly body: string | undefined;
  /** Attach and accept cookies. Only ever true in cookie mode. */
  readonly withCredentials: boolean;
  readonly signal: AbortSignal | undefined;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: string;
}

/**
 * How a request leaves the process.
 *
 * A structural port with no shared logic, so it is an interface rather than an abstract class
 * (PROJECT.md 7.2.6). It exists because the runtimes we ship to disagree about what `fetch`
 * is: a customer behind a corporate proxy, one who wants tracing on every call, and a test
 * that must not touch the network all substitute here.
 */
export interface Transport {
  send(request: ApiRequest): Promise<ApiResponse>;
}

/** The subset of `fetch` we use, so a substitute does not have to implement all of it. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The transport we ship, over the runtime's own `fetch`.
 *
 * Cookies are `omit` unless the caller asked for them, which is a real control and not a
 * default. A browser attaches its cookie jar to anything on the origin, so a request that
 * declared header mode would still carry the session cookie, and the server's cross-site
 * checks deliberately do not run in header mode. Omitting them keeps the two modes as
 * separate as the client said they were.
 */
export class FetchTransport implements Transport {
  private readonly fetch: FetchLike;

  constructor(fetch?: FetchLike) {
    // Bound to `globalThis` on purpose: an extracted browser `fetch` called with the wrong
    // receiver throws "Illegal invocation", and it would do so on the first request rather
    // than here, where the cause is legible.
    const resolved = fetch ?? globalThis.fetch?.bind(globalThis);
    if (typeof resolved !== "function") {
      throw new IdenzyTransportError(
        "This runtime has no global fetch. Pass one to the Idenzy client.",
      );
    }
    this.fetch = resolved;
  }

  async send(request: ApiRequest): Promise<ApiResponse> {
    const response = await this.exchange(request);
    return { status: response.status, body: await this.read(response, request.url) };
  }

  private async exchange(request: ApiRequest): Promise<Response> {
    try {
      return await this.fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        credentials: request.withCredentials ? "include" : "omit",
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (error: unknown) {
      // Every reason a request never happened arrives here as one opaque TypeError: offline,
      // DNS, TLS, and a CORS refusal that the browser will not describe to script. The cause
      // is kept so a developer can see the original in the console.
      throw new IdenzyTransportError(`The request to ${request.url} did not complete.`, {
        cause: error,
      });
    }
  }

  private async read(response: Response, url: string): Promise<string> {
    try {
      return await response.text();
    } catch (error: unknown) {
      throw new IdenzyTransportError(`The response from ${url} could not be read.`, {
        status: response.status,
        cause: error,
      });
    }
  }
}
