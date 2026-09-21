import { AppConfig } from "@idenzy/config/app-config";
import { ProjectDomainRepository } from "@idenzy/persistence/repository/project-domain-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { ProjectDomainStatus, ProjectDomainType } from "@idenzy/protocol/enums/tenancy";
import { Injectable } from "@nestjs/common";

/** Where a project's mail goes out from, and whose reputation is behind it. */
export interface SendingIdentity {
  readonly from: string;
  /**
   * Whether this is our own shared sender.
   *
   * The distinction the whole ceiling rests on. A project that configured nothing sends
   * from `mail.idenzy.io`, which every other such project also sends from, so one of them
   * blasting to scraped addresses puts the rest in spam — SES scores reputation per
   * domain. A project on its own verified domain damages mostly itself.
   */
  readonly shared: boolean;
}

/**
 * The address a project's mail is sent from (PROJECT.md 11.2).
 *
 * Until this existed, `Mailer` read one `EMAIL_FROM_ADDRESS` out of the environment and
 * every project sent from it — including customers paying $5 a month for a sending domain
 * of their own, whose verified identity was collected, displayed and never used. So this
 * is not only a control: it is the half of that product which was missing.
 *
 * A domain counts only when it is `verified`. One that is pending has DNS records
 * published and unconfirmed, and sending from an unverified identity is how a message
 * arrives unsigned, fails DMARC on a domain published as `p=reject`, and goes silently
 * nowhere (PROJECT.md 11.2).
 */
@Injectable()
export class SendingDomains {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly config: AppConfig,
  ) {}

  async forProject(projectId: string): Promise<SendingIdentity> {
    const shared = { from: this.config.get("EMAIL_FROM_ADDRESS"), shared: true } as const;
    const tenant = new TenantContext(projectId, "delivery", "system");
    const domains = await this.uow.transaction((tx) =>
      new ProjectDomainRepository(tx, tenant).list(ProjectDomainType.Email),
    );
    const verified = domains.find((domain) => domain.status === ProjectDomainStatus.Verified);
    if (verified === undefined) return shared;
    // The local part is ours and the domain is theirs: a customer verifies a domain, not
    // an address, so inventing a mailbox on it would be sending as somebody who may not
    // exist. `no-reply` is the one every provider's own transactional mail uses.
    return { from: `no-reply@${verified.domain}`, shared: false };
  }
}
