import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { IdenzyError } from "@idenzy/core/errors/idenzy-error";
import type { Logger } from "@idenzy/core/logging/logger";
import type { TaskCallerVerifier } from "../google/task-caller-verifier.js";
import type { TaskOutcome } from "../webhooks/webhook-task-endpoint.js";

/**
 * The part of `WebhookTaskEndpoint` this server calls.
 *
 * A structural port and not a base class, because there is no shared behaviour to inherit — it exists
 * so the routing, the token and the status codes can be tested without a database behind them.
 */
export interface TaskRunner {
  run(body: unknown): Promise<TaskOutcome>;
}

/** What the retry lane needs to be reachable: a path, who may call it, and what to run. */
export interface DispatchRoute {
  /** Taken from `WEBHOOK_DISPATCH_URL`, so the task's target and the route cannot disagree. */
  readonly path: string;
  readonly verifier: TaskCallerVerifier;
  readonly endpoint: TaskRunner;
}

export interface InternalServerOptions {
  readonly port: number;
  /** Absent in every environment without a queue, and then this serves health only. */
  readonly dispatch?: DispatchRoute;
}

/**
 * A task body is an address (`WebhookTaskBody`), so anything larger than this is not one.
 *
 * Small on purpose. Reading an unbounded body from whoever can reach the socket is the cheapest
 * denial of service there is, so the declared length is refused before a byte is read and the stream
 * is capped anyway in case the declaration was a lie.
 */
const MAX_BODY_BYTES = 4 * 1024;

/**
 * The only HTTP surface this worker has: health, and the retry lane's entry.
 *
 * `node:http` rather than Fastify or a Nest application, which is the trade PROJECT.md 7.6 asks for —
 * two routes, one of which answers a fixed object, do not earn a framework in a process that has had
 * no HTTP surface at all until now. The APIs keep theirs because they have two hundred routes, a
 * validation pipeline and an error filter to hang off it.
 *
 * It exists for two reasons that arrived together. Cloud Tasks delivers a retry by calling a URL, so
 * there has to be one; and a Cloud Run service has to listen on `$PORT` to be considered healthy at
 * all, which is why the worker being a queue-less relay was only ever going to work locally.
 */
export class InternalServer {
  private server: Server | null = null;

  constructor(
    private readonly options: InternalServerOptions,
    private readonly logger: Logger,
  ) {}

  /** Answers the port it actually bound, which is what a test needs when it asks for zero. */
  async start(): Promise<number> {
    const server = createServer((request, response) => {
      void this.route(request, response);
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    const address = server.address();
    const port = address !== null && typeof address === "object" ? address.port : this.options.port;
    this.logger.info("workers listening", {
      component: "internal-server",
      outcome: "started",
      port,
      path: this.options.dispatch?.path ?? "none",
    });
    return port;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server === null) return;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    const dispatch = this.options.dispatch;

    if (request.method === "GET" && path === "/healthz") {
      // Liveness only, and it says so. Whether the relay is keeping up is a question about its
      // watermark, and a health check that answered it would take the process out of service for
      // something a restart does not fix.
      this.answer(response, 200, { status: "ok" });
      return;
    }

    if (dispatch === undefined || request.method !== "POST" || path !== dispatch.path) {
      this.answer(response, 404, { error: "not_found" });
      return;
    }

    await this.dispatch(dispatch, request, response);
  }

  private async dispatch(
    route: DispatchRoute,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const token = bearer(request.headers.authorization);
    if (token === null) {
      this.answer(response, 401, { error: "unauthenticated" });
      return;
    }
    if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
      this.answer(response, 413, { error: "too_large" });
      return;
    }

    let body: unknown;
    try {
      await route.verifier.verify(token);
      body = JSON.parse(await this.read(request));
    } catch (error: unknown) {
      // A token that does not verify and a body that is not JSON are both permanent: the queue is
      // told 401 or 400 and the task is done, because sending the same bytes again would fail the
      // same way. Only an outcome that might differ next time is worth a retry, and the sweeper
      // already covers those.
      this.refuse(response, error);
      return;
    }

    try {
      const outcome = await route.endpoint.run(body);
      this.answer(response, 200, { outcome });
    } catch (error: unknown) {
      if (error instanceof IdenzyError && error.status < 500) {
        this.refuse(response, error);
        return;
      }
      // 503 rather than 200, so the failure is visible in the queue's own metrics. It costs nothing:
      // the queue makes one attempt per task by configuration — the schedule is ours — so the row is
      // recovered by the sweeper either way.
      this.logger.error("webhook task failed", {
        component: "internal-server",
        outcome: "failed",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      this.answer(response, 503, { error: "unavailable" });
    }
  }

  /** Reads the body, refusing anything that is not the size a task body is. */
  private read(request: IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_BODY_BYTES) {
          request.destroy();
          reject(new RangeError("body too large"));
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      request.on("error", reject);
    });
  }

  private refuse(response: ServerResponse, error: unknown): void {
    const status = error instanceof IdenzyError ? error.status : 400;
    this.logger.warn("webhook task refused", {
      component: "internal-server",
      outcome: "refused",
      statusCode: status,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    this.answer(response, status, { error: error instanceof IdenzyError ? error.code : "invalid" });
  }

  private answer(response: ServerResponse, status: number, body: Readonly<object>): void {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload)),
    });
    response.end(payload);
  }
}

/** The token out of an `Authorization` header, or null because there is not one. */
function bearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const [scheme, ...rest] = header.split(" ");
  const token = rest.join(" ").trim();
  if (scheme?.toLowerCase() !== "bearer" || token === "") return null;
  return token;
}
