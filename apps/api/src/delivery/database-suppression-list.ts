import { DeliverySuppressedError } from "@idenzy/core/errors";
import { suppressionDigest } from "@idenzy/crypto/delivery/suppression-digest";
import type { SuppressionList } from "@idenzy/domain/ports/email-provider";
import { SuppressionRepository } from "@idenzy/persistence/repository/suppression-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Channel } from "@idenzy/protocol/enums/delivery";
import { Injectable } from "@nestjs/common";

/**
 * The suppression check the EmailProvider base runs before any transport
 * (PROJECT.md 11.1).
 *
 * The address is hashed here and only the digest reaches the query, matching how the
 * bounce handler writes it. That keeps the table from being a harvestable list of every
 * address that ever bounced for a customer, and it keeps the address out of the
 * database's own query logs.
 */
@Injectable()
export class DatabaseSuppressionList implements SuppressionList {
  constructor(private readonly uow: UnitOfWork) {}

  async assertSendable(projectId: string, target: string): Promise<void> {
    const tenant = new TenantContext(projectId, "delivery", "system");
    const suppressed = await this.uow.transaction((tx) =>
      new SuppressionRepository(tx, tenant).isSuppressed(Channel.Email, suppressionDigest(target)),
    );
    if (suppressed) throw new DeliverySuppressedError();
  }
}
