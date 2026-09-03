import { Clock } from "@idenzy/core/time/clock";
import type { UsageMeter } from "@idenzy/domain/ports/email-provider";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Channel } from "@idenzy/protocol/enums/delivery";
import { Injectable } from "@nestjs/common";

/**
 * Counts what was sent, per project per day (PROJECT.md 5.1).
 *
 * `assertWithinQuota` allows everything today, and saying so plainly is better than a
 * method that looks like a limit and is not: plan ceilings arrive with metering and
 * billing in phase 1.6, and they land here. The base class already calls this on every
 * send, so turning it on is a change to this file alone.
 */
@Injectable()
export class DatabaseUsageMeter implements UsageMeter {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  assertWithinQuota(_projectId: string, _channel: Channel): Promise<void> {
    return Promise.resolve();
  }

  async record(
    projectId: string,
    channel: Channel,
    _meta: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (channel !== Channel.Email) return;
    const tenant = new TenantContext(projectId, "delivery", "system");
    await this.uow.run(tenant, (tx) =>
      new UsageRepository(tx, tenant).recordEmailSent(this.clock.now()),
    );
  }
}
