import type { AppConfig } from "@idenzy/config/app-config";
import { InternalError, ValidationFailedError } from "@idenzy/core/errors";
import type { Logger } from "@idenzy/core/logging/logger";
import type { AccessTokenSource } from "@idenzy/providers-gcp/access-token-source";
import { DeliveryScheduler, type ScheduledDelivery } from "./delivery-scheduler.js";
import { WebhookTaskBody } from "./webhook-task-body.js";

/** Where the queue is, who the task calls, and as whom. */
export interface CloudTasksSettings {
  /** Our own Cloud project, which has nothing to do with a customer's. */
  readonly project: string;
  readonly location: string;
  /** Queues are `${prefix}-0` to `${prefix}-${shards - 1}`, which is what Terraform makes. */
  readonly queuePrefix: string;
  readonly shards: number;
  /** The identity the task's OIDC token is minted for, and the one the dispatcher requires. */
  readonly serviceAccount: string;
  readonly url: string;
  readonly audience: string;
}

export interface CloudTasksOptions {
  /**
   * The API root, so a test can stand in for Google.
   *
   * A constructor option and deliberately not an environment variable: a value that decided where a
   * token gets sent does not belong somewhere a deployment can set it.
   */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

const API_BASE_URL = "https://cloudtasks.googleapis.com";
const CALL_TIMEOUT_MS = 5_000;

/**
 * How long Cloud Tasks waits for the dispatcher before giving up on a task.
 *
 * Sixty seconds against a retry attempt's fifteen, so the slot is bounded without being tight: an
 * attempt plus the writes around it has room, and a handler wedged on something else stops holding a
 * dispatch slot in a minute rather than in the ten the default allows. Nothing is lost when it is
 * exceeded — the queue does not retry (that is ours), and the sweeper finds the row.
 */
const DISPATCH_DEADLINE = "60s";

/** The five variables that have to travel together, named for the error when they do not. */
const REQUIRED = [
  "GCP_PROJECT_ID",
  "WEBHOOK_TASKS_LOCATION",
  "WEBHOOK_TASKS_QUEUE_PREFIX",
  "WEBHOOK_TASKS_SERVICE_ACCOUNT",
  "WEBHOOK_DISPATCH_URL",
] as const;

/**
 * Arms a retry as a Cloud Task: one task per attempt, at the time our own schedule says (ADR-0012).
 *
 * Written against the REST API with `fetch` and the metadata server rather than `@google-cloud/tasks`,
 * which is a deliberate call under PROJECT.md 7.6. The client library brings gRPC and its transitive
 * tree into a service whose whole use of it is one POST with four fields; a builtin and twenty lines
 * of JSON is the cheaper dependency and the one we can read.
 *
 * Two properties are worth stating because they are what make the queue safe to lose. The task
 * carries an address and not the delivery (`WebhookTaskBody`), so it cannot deliver a stale body. And
 * the queue is configured with no retry policy of its own, because the schedule is published and ours
 * — a queue retrying on top of it would turn seven documented delays into something nobody can quote.
 */
export class CloudTasksScheduler extends DeliveryScheduler {
  constructor(
    private readonly tokens: AccessTokenSource,
    private readonly settings: CloudTasksSettings,
    private readonly logger: Logger,
    private readonly options: CloudTasksOptions = {},
  ) {
    super();
  }

  /**
   * The queue's settings, or null because this deployment has no queue.
   *
   * All five or none. Four out of five would fall back to the sweeper and the only symptom would be
   * retry latency nobody is watching, so a half-configured deployment does not start.
   */
  static settingsFrom(config: AppConfig): CloudTasksSettings | null {
    const given = REQUIRED.filter((key) => config.get(key) !== undefined);
    if (given.length === 0) return null;
    if (given.length < REQUIRED.length) {
      throw new ValidationFailedError({
        message: "The webhook retry queue is only half configured.",
        fields: REQUIRED.filter((key) => config.get(key) === undefined).map((key) => ({
          path: key,
          code: "required_with_siblings",
        })),
      });
    }

    const url = config.get("WEBHOOK_DISPATCH_URL") ?? "";
    return {
      project: config.get("GCP_PROJECT_ID") ?? "",
      location: config.get("WEBHOOK_TASKS_LOCATION") ?? "",
      queuePrefix: config.get("WEBHOOK_TASKS_QUEUE_PREFIX") ?? "",
      shards: config.get("WEBHOOK_TASKS_QUEUE_SHARDS"),
      serviceAccount: config.get("WEBHOOK_TASKS_SERVICE_ACCOUNT") ?? "",
      url,
      // Cloud Tasks defaults the audience to the target URL, so defaulting it the same way here keeps
      // the two halves saying the same thing when nobody sets it.
      audience: config.get("WEBHOOK_DISPATCH_AUDIENCE") ?? url,
    };
  }

  override async schedule(delivery: ScheduledDelivery, at: Date): Promise<void> {
    const queue = this.queueFor(delivery.webhookId);
    const body = Buffer.from(
      JSON.stringify(WebhookTaskBody.of(delivery.id, delivery.projectId).toJSON()),
      "utf8",
    ).toString("base64");

    const response = await fetch(this.tasksUrl(queue), {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.tokens.token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        task: {
          scheduleTime: at.toISOString(),
          dispatchDeadline: DISPATCH_DEADLINE,
          httpRequest: {
            url: this.settings.url,
            httpMethod: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            oidcToken: {
              serviceAccountEmail: this.settings.serviceAccount,
              audience: this.settings.audience,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? CALL_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The likeliest 404 is a shard count larger than the number of queues Terraform made, which is
      // worth saying out loud: that share of retries waits for the sweeper instead.
      this.logger.warn("cloud tasks refused a retry task", {
        component: "cloud-tasks",
        outcome: "refused",
        statusCode: response.status,
        queue,
      });
      throw new InternalError({
        detail: { component: "cloud-tasks", status: response.status, queue },
      });
    }
  }

  /**
   * Which queue an endpoint's retries go to, and always the same one for the same endpoint.
   *
   * A hash rather than a counter, because the property that matters is stability rather than balance:
   * an endpoint whose retries are spread across the pool would have its dispatch rate multiplied by
   * the number of shards, which is the per-customer ceiling gone.
   */
  private queueFor(webhookId: string): string {
    return `${this.settings.queuePrefix}-${shardOf(webhookId, this.settings.shards)}`;
  }

  private tasksUrl(queue: string): string {
    const { project, location } = this.settings;
    const base = this.options.baseUrl ?? API_BASE_URL;
    return `${base}/v2/projects/${project}/locations/${location}/queues/${queue}/tasks`;
  }
}

/** FNV-1a, for a stable shard from an id. Not a security choice: nothing here is a secret. */
export function shardOf(id: string, shards: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % shards;
}
