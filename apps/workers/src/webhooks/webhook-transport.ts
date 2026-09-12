import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  isBlockedWebhookHost,
  WEBHOOK_RESPONSE_EXCERPT_BYTES,
} from "@idenzy/protocol/schemas/webhooks";

/** What one attempt found: an answer, or a reason there was none. Never both. */
export interface TransportResult {
  /** The status the endpoint answered with, or null where nothing did. */
  readonly status: number | null;
  /** Why there is no status, in terms a developer can act on. Null where there is one. */
  readonly error: string | null;
  readonly durationMs: number;
  /** The first bytes of the response, as text. Capped before it leaves this file. */
  readonly excerpt: string;
}

export interface TransportRequest {
  readonly url: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

/**
 * How a delivery leaves the building.
 *
 * An abstract base with one real implementation, for the reason PROJECT.md 7.2 gives: the dispatcher
 * decides *what* a delivery says and *when* it goes again, and neither of those should have to know
 * that the sending is HTTPS over a pinned address. It is also the seam the tests need — a delivery
 * that must be proved to carry a verifiable signature is easier to observe through a fake than
 * through a socket.
 */
export abstract class WebhookTransport {
  abstract send(request: TransportRequest): Promise<TransportResult>;
}

/**
 * Where a hostname resolves, and whether any of it may be called.
 *
 * The list is the mitigation for what ADR-0012 left open: a hostname that *parses* as public can
 * still resolve to a private address, and the parse cannot see that. So the addresses are resolved
 * here, every one is checked, and the connection is made to the address that was checked rather
 * than to the name — which closes the window between the check and the connect that a rebinding
 * attack lives in.
 */
interface ResolvedTarget {
  readonly address: string;
  readonly family: number;
}

/** Node's own error codes, turned into something a customer's developer can act on. */
const ERRORS: Readonly<Record<string, string>> = {
  ECONNREFUSED: "The connection was refused.",
  ECONNRESET: "The connection was reset before an answer arrived.",
  ENOTFOUND: "That hostname does not resolve.",
  EAI_AGAIN: "That hostname could not be resolved right now.",
  ETIMEDOUT: "The connection timed out.",
  EPROTO: "The TLS handshake failed.",
  CERT_HAS_EXPIRED: "The TLS certificate has expired.",
  DEPTH_ZERO_SELF_SIGNED_CERT: "The TLS certificate is self-signed.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The TLS certificate could not be verified.",
};

export interface HttpsTransportOptions {
  /**
   * Whether a loopback endpoint over plain http may be called.
   *
   * Development only, and gated on the environment by the caller rather than by a flag somebody
   * could set: a developer running their own receiver on `localhost:4000` has no other way to try
   * this, and a production deployment calling loopback would be calling itself. It is the same
   * shape of exception the CORS policy makes for a development origin.
   */
  readonly allowLoopbackHttp?: boolean;
}

/**
 * The real one: HTTPS to an address we resolved and checked ourselves.
 *
 * `node:https` rather than `fetch`, for three things `fetch` makes awkward and this needs all of.
 * The connection goes to a pinned address with the server name set to the hostname, so TLS still
 * verifies against the certificate the customer holds. The response body is read up to a cap and
 * the socket is then destroyed, because a receiver answering with a hundred megabytes must not be
 * able to make that our problem. And a hard deadline covers the whole attempt rather than the
 * headers alone, which is what a slow endpoint actually costs.
 */
export class HttpsWebhookTransport extends WebhookTransport {
  constructor(private readonly options: HttpsTransportOptions = {}) {
    super();
  }

  async send(request: TransportRequest): Promise<TransportResult> {
    const started = Date.now();
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return this.failed("That URL cannot be parsed.", started);
    }

    const loopback = this.options.allowLoopbackHttp === true && isLoopbackName(url.hostname);
    if (url.protocol !== "https:" && !loopback) {
      return this.failed("Only https endpoints are called.", started);
    }

    const target = await this.resolveAllowed(url.hostname, loopback);
    if (target === null) {
      return this.failed(
        "That hostname resolves to an address deliveries are not sent to.",
        started,
      );
    }

    return await this.attempt(url, target, request, started);
  }

  /**
   * Every address the name resolves to, refused unless all of them are public.
   *
   * All of them and not the first: a name that answers with one public and one private address
   * would otherwise be a coin toss between a delivery and an internal request.
   */
  private async resolveAllowed(
    hostname: string,
    loopback: boolean,
  ): Promise<ResolvedTarget | null> {
    if (loopback) return { address: hostname === "localhost" ? "127.0.0.1" : hostname, family: 4 };
    let addresses: readonly ResolvedTarget[];
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      return null;
    }
    if (addresses.length === 0) return null;
    if (addresses.some((entry) => isBlockedWebhookHost(bracketed(entry)))) return null;
    const first = addresses[0];
    return first === undefined ? null : first;
  }

  private attempt(
    url: URL,
    target: ResolvedTarget,
    request: TransportRequest,
    started: number,
  ): Promise<TransportResult> {
    const secure = url.protocol === "https:";
    const send = secure ? httpsRequest : httpRequest;
    const body = Buffer.from(request.body, "utf8");

    return new Promise<TransportResult>((resolve) => {
      let settled = false;
      const finish = (result: TransportResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const outgoing = send(
        {
          // The address we checked, with the name carried in `Host` and in SNI so the certificate
          // still has to be the one for the hostname the customer registered.
          host: target.address,
          servername: secure ? url.hostname : undefined,
          port: url.port === "" ? (secure ? 443 : 80) : Number(url.port),
          method: "POST",
          path: `${url.pathname}${url.search}`,
          headers: {
            ...request.headers,
            host: url.host,
            "content-type": "application/json",
            "content-length": String(body.byteLength),
            "user-agent": "Idenzy-Webhooks/1",
            accept: "*/*",
          },
          // Nothing follows a redirect: a 3xx is a receiver that has not taken the delivery, and
          // following one would send a customer's events wherever an attacker's Location pointed.
          timeout: request.timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let read = 0;
          response.on("data", (chunk: Buffer) => {
            read += chunk.byteLength;
            if (read <= WEBHOOK_RESPONSE_EXCERPT_BYTES) chunks.push(chunk);
            // Past the cap the rest is of no interest, and reading it is the receiver deciding
            // how much memory we spend.
            else response.destroy();
          });
          const done = () =>
            finish({
              status: response.statusCode ?? null,
              error: null,
              durationMs: Date.now() - started,
              excerpt: Buffer.concat(chunks)
                .subarray(0, WEBHOOK_RESPONSE_EXCERPT_BYTES)
                .toString("utf8"),
            });
          response.on("end", done);
          response.on("close", done);
          response.on("error", done);
        },
      );

      outgoing.setTimeout(request.timeoutMs, () => {
        outgoing.destroy();
        finish(
          this.failedNow(`No answer within ${Math.round(request.timeoutMs / 1000)}s.`, started),
        );
      });
      outgoing.on("error", (error: NodeJS.ErrnoException) => {
        finish(this.failedNow(reasonOf(error), started));
      });
      outgoing.end(body);
    });
  }

  private failed(reason: string, started: number): Promise<TransportResult> {
    return Promise.resolve(this.failedNow(reason, started));
  }

  private failedNow(reason: string, started: number): TransportResult {
    return { status: null, error: reason, durationMs: Date.now() - started, excerpt: "" };
  }
}

function reasonOf(error: NodeJS.ErrnoException): string {
  const code = error.code ?? "";
  return ERRORS[code] ?? (code === "" ? "The request failed." : `The request failed (${code}).`);
}

/** An IPv6 address has to wear its brackets to be recognised as a host. */
function bracketed(target: ResolvedTarget): string {
  return target.family === 6 ? `[${target.address}]` : target.address;
}

function isLoopbackName(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
