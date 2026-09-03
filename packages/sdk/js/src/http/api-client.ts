import { IdenzyCookie, IdenzyHeader } from "@idenzy/protocol/http/headers";
import type { ZodType } from "zod";
import type { IdenzyConfig } from "../config.js";
import { errorFromResponse, IdenzyTransportError } from "../errors.js";
import type { CookieJar } from "./cookie-jar.js";
import type { ApiResponse, Transport } from "./transport.js";

/** Methods that change something, and therefore the ones the CSRF header belongs on. */
const UNSAFE = new Set(["POST", "PATCH", "DELETE"]);

export interface RequestSpec {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Relative to the configured API URL, without a leading slash. */
  readonly path: string;
  readonly body?: unknown;
  /** The access token to present. Absent on the routes that establish a session. */
  readonly accessToken?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Everything this SDK knows about talking to the auth API: which project, how the session is
 * carried, and what an answer has to look like before a caller sees it.
 *
 * Responses are parsed against the protocol's own schemas rather than cast. That is not
 * ceremony: a proxy, a captive portal or a mistyped API URL can all answer 200 with something
 * shaped nothing like us, and the alternative to parsing is a `TypeError` inside a customer's
 * component with no indication of where the wrong value came from (PROJECT.md 7.1).
 */
export class ApiClient {
  constructor(
    private readonly config: IdenzyConfig,
    private readonly transport: Transport,
    private readonly cookies: CookieJar,
  ) {}

  /** Sends, then parses the answer. The schema is the protocol's, never a local copy. */
  async send<T>(schema: ZodType<T>, spec: RequestSpec): Promise<T> {
    const response = await this.exchange(spec);
    const parsed = schema.safeParse(readJson(response.body));
    if (!parsed.success) {
      throw new IdenzyTransportError(
        `The answer from ${spec.path} was not the shape this endpoint promises.`,
        { status: response.status, cause: parsed.error },
      );
    }
    return parsed.data;
  }

  /** For the routes that answer 202 or 204 and mean it. */
  async sendVoid(spec: RequestSpec): Promise<void> {
    await this.exchange(spec);
  }

  private async exchange(spec: RequestSpec): Promise<ApiResponse> {
    const body = spec.body === undefined ? undefined : JSON.stringify(spec.body);
    const response = await this.transport.send({
      url: this.config.urlFor(spec.path),
      method: spec.method,
      headers: this.headersFor(spec, body !== undefined),
      body,
      withCredentials: this.config.usesCookies,
      signal: spec.signal,
    });
    if (response.status >= 400) throw errorFromResponse(response.status, response.body);
    return response;
  }

  /**
   * The publishable key goes on every request, including the ones that also carry a token.
   * It is read first and `Authorization` second, so a signed-in request still names its
   * project rather than resolving through whatever host it happened to reach.
   */
  private headersFor(spec: RequestSpec, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      [IdenzyHeader.PublishableKey]: this.config.publishableKey,
      [IdenzyHeader.SessionTransport]: this.config.sessionTransport,
    };
    if (hasBody) headers["content-type"] = "application/json";
    if (spec.accessToken !== undefined) headers["authorization"] = `Bearer ${spec.accessToken}`;
    const csrf = this.csrfFor(spec.method);
    if (csrf !== undefined) headers[IdenzyHeader.Csrf] = csrf;
    return headers;
  }

  /**
   * Echoes the CSRF cookie, and only where it means something.
   *
   * Sent even on the routes that have no cookie to echo yet, because the server demands it
   * only once a session is actually presented and an absent value is simply not checked.
   * Sending it unconditionally in cookie mode is what keeps this out of every call site.
   */
  private csrfFor(method: string): string | undefined {
    if (!this.config.usesCookies || !UNSAFE.has(method)) return undefined;
    return this.cookies.read(IdenzyCookie.Csrf);
  }
}

function readJson(body: string): unknown {
  try {
    return body.length === 0 ? undefined : JSON.parse(body);
  } catch {
    return undefined;
  }
}
