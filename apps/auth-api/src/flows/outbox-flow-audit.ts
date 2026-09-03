import { Clock } from "@idenzy/core/time/clock";
import type { FlowAudit, FlowContext } from "@idenzy/domain/ports/auth-flow";
import { OutboxRepository } from "@idenzy/persistence/repository/outbox-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Writes the flow-level audit trail to the outbox, which a worker relays into the
 * hash-chained `audit_events` table (PROJECT.md 4.13.3).
 *
 * This runs in its own transaction, after the one that created the session, and that is
 * a deliberate limit rather than an oversight: `AuthFlow` hands its audit port no
 * transaction, so the two cannot be atomic without giving every flow a persistence
 * concept it should not have. The atomic record of a sign-in is the `session.created`
 * event SessionService writes alongside the session row; this is the flow-shaped view of
 * the same fact, carrying which method was used.
 */
@Injectable()
export class OutboxFlowAudit implements FlowAudit {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async record(
    context: FlowContext,
    action: string,
    meta: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const tenant = tenantContextFrom(context);
    await this.uow.run(tenant, (tx) =>
      new OutboxRepository(tx, tenant).enqueue("audit.recorded", {
        action,
        requestId: context.requestId,
        ip: context.ip,
        userAgent: context.userAgent,
        at: this.clock.now().toISOString(),
        ...meta,
      }),
    );
  }
}
