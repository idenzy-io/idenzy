import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import type { ZodType } from "zod";
import type { IdenzyConfig } from "../config.js";
import { errorFromResponse, IdenzyApiError, IdenzyTransportError } from "../errors.js";
import type { ApiRequest, ApiResponse, Transport } from "./transport.js";
import type { TransportMode } from "./transport-mode.js";

export interface RequestSpec {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Relative to the configured API URL, without a leading slash. */
  readonly path: string;
  readonly body?: unknown;
  /** The access token to present. Absent on the routes that establish a session. */
  readonly accessToken?: string | undefined;
  /**
   * Carries the configured device name. Set by `SessionFlow.establish` and nowhere else:
   * the name is read only where a session row is written, so on any other route it would be
   * bytes on every request that nothing ever looks at.
   */
  readonly namesDevice?: boolean;
  /**
   * A CAPTCHA or app-attestation token, for the routes that spend money on a request.
   *
   * Per call rather than on the client, because the token is single-use and belongs to the
   * challenge the visitor just solved. A client that held one would send a stale token on
   * the second attempt, which fails in the way that looks like the widget is broken.
   */
  readonly attestation?: string | undefined;
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
    private readonly mode: TransportMode,
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

  /**
   * For the routes whose honest answer is "there is nothing here", which they say with 204.
   *
   * A separate method rather than a nullable schema, because the distinction is in the status
   * and not the body: a 204 has no body to parse, and treating an empty one as a parse failure
   * would turn a correct answer into a transport error.
   */
  async sendOptional<T>(schema: ZodType<T>, spec: RequestSpec): Promise<T | null> {
    const response = await this.exchange(spec);
    if (response.status === 204) return null;
    const parsed = schema.safeParse(readJson(response.body));
    if (!parsed.success) {
      throw new IdenzyTransportError(
        `The answer from ${spec.path} was not the shape this endpoint promises.`,
        { status: response.status, cause: parsed.error },
      );
    }
    return parsed.data;
  }

  /**
   * One attempt, or two when the first was refused for asking for cookie mode.
   *
   * The retry is safe and it is worth saying why rather than trusting that it is. The refusal
   * comes from a guard that runs before the handler, so the refused request did nothing: no
   * code spent, no token rotated, no mail sent. Only that one error code is retried, and only
   * while the mode has a downgrade left to make, so there is no path here that loops.
   */
  private async exchange(spec: RequestSpec): Promise<ApiResponse> {
    const response = await this.attempt(spec);
    if (response.status < 400) return response;

    const refusal = errorFromResponse(response.status, response.body);
    if (!this.renegotiated(refusal)) throw refusal;

    const retried = await this.attempt(spec);
    if (retried.status >= 400) throw errorFromResponse(retried.status, retried.body);
    return retried;
  }

  private attempt(spec: RequestSpec): Promise<ApiResponse> {
    const body = spec.body === undefined ? undefined : JSON.stringify(spec.body);
    return this.transport.send({
      url: this.config.urlFor(spec.path),
      method: spec.method,
      headers: this.headersFor(spec, body !== undefined),
      body,
      withCredentials: this.mode.usesCookies,
      signal: spec.signal,
    } satisfies ApiRequest);
  }

  /** Short-circuits deliberately: nothing downgrades unless this is the code that means it. */
  private renegotiated(error: unknown): boolean {
    return (
      error instanceof IdenzyApiError &&
      error.code === ErrorCode.SessionTransportUnavailable &&
      this.mode.downgrade()
    );
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
      [IdenzyHeader.SessionTransport]: this.mode.current,
    };
    if (hasBody) headers["content-type"] = "application/json";
    // Percent-encoded because a header value is bytes: a name in most languages throws in
    // `fetch` before it reaches the network.
    if (spec.namesDevice === true && this.config.deviceName !== null) {
      headers[IdenzyHeader.DeviceName] = encodeURIComponent(this.config.deviceName);
    }
    // Sent exactly as the provider issued it, unlike the device name. This value is
    // compared byte for byte against the issuer's own copy, and the server has to accept
    // it raw from callers that are not this SDK, so encoding here would only create a
    // form the two sides could disagree about.
    if (spec.attestation !== undefined) headers[IdenzyHeader.Attestation] = spec.attestation;
    if (spec.accessToken !== undefined) headers["authorization"] = `Bearer ${spec.accessToken}`;
    return headers;
  }
}

function readJson(body: string): unknown {
  try {
    return body.length === 0 ? undefined : JSON.parse(body);
  } catch {
    return undefined;
  }
}
