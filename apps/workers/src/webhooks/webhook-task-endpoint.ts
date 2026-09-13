import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import { WebhookDeliveryRepository } from "@idenzy/persistence/repository/webhook-delivery-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { WebhookDispatcher } from "./webhook-dispatcher.js";
import { WebhookTaskBody } from "./webhook-task-body.js";

/**
 * What a task did, which is one of two things and neither is a failure.
 *
 * `skipped` is the ordinary outcome for a duplicate, and there will be duplicates: a queue is
 * at-least-once, so the honest shape of this endpoint is one that can be called twice about the same
 * delivery and answer the second one with nothing.
 */
export type TaskOutcome = "attempted" | "skipped";

/**
 * The retry lane's entry point: one task, one delivery, one attempt (ADR-0012).
 *
 * Split from the HTTP server on purpose. What a task means is a claim and a dispatch, and that is
 * testable against a real database without a socket; what the server adds is a token to verify and a
 * status code to answer with. Keeping them apart is also what makes the rule below readable in one
 * place — this endpoint never decides *when* the next attempt is, it only makes the one that is due.
 */
export class WebhookTaskEndpoint {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly dispatcher: WebhookDispatcher,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /**
   * Attempts the delivery a task names, if it is still open and actually due.
   *
   * The claim is the whole of the concurrency story. `claimIfDue` is one statement, so a duplicate
   * task, a sweeper that got there first and a task that arrives while the first attempt is still in
   * flight all lose the same way: nothing to do, and nobody's endpoint is called twice about one
   * event.
   */
  async run(body: unknown): Promise<TaskOutcome> {
    const task = WebhookTaskBody.parse(body);
    const tenant = new TenantContext(task.projectId, "webhook-task", "system");

    const claimed = await this.uow.run(tenant, (tx) =>
      new WebhookDeliveryRepository(tx, tenant).claimIfDue(task.deliveryId, this.clock.now()),
    );
    if (claimed === null) {
      this.logger.debug("webhook task found nothing to send", {
        component: "webhook-task",
        outcome: "skipped",
        projectId: task.projectId,
      });
      return "skipped";
    }

    await this.dispatcher.dispatch(task.projectId, claimed, "retry");
    return "attempted";
  }
}
