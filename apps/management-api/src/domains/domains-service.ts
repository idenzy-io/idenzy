import { ResourceConflictError, ResourceNotFoundError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { generateOpaqueToken } from "@idenzy/crypto/tokens/random";
import {
  type DomainDnsRecord,
  ProjectDomainRepository,
  type ProjectDomainRow,
} from "@idenzy/persistence/repository/project-domain-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { ProjectDomainStatus, ProjectDomainType } from "@idenzy/protocol/enums/tenancy";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { ProjectDomain } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";
import { DnsVerifier } from "./dns-verifier.js";

/** What the routing CNAME points at: our global load balancer, the same for every customer. */
const LOAD_BALANCER_TARGET = "edge.idenzy.io";

/** The label Google Certificate Manager hangs its DNS authorisation off. */
const CERT_AUTH_PREFIX = "_acme-challenge";

/**
 * Custom auth domains: claiming one, checking its DNS, and giving it up (PROJECT.md 4.3).
 *
 * This is the screen that unblocks cookie mode, and the reason is `SameSite`. It is a
 * *site* rule, not an origin one, so a customer's app at `app.customer.com` is same-site
 * with `auth.customer.com` and cross-site with our shared host — which is why a custom
 * auth domain is a precondition rather than a convenience, and why nothing routes to one
 * until its records actually resolve.
 *
 * Two records, and they do different jobs. The CNAME sends traffic to our edge; the
 * authorisation CNAME is what proves to Certificate Manager that the person asking
 * controls the name. Requiring both is also what makes a claim safe to honour: a hostname
 * is unique across every project, so verifying on the routing record alone would let
 * somebody park a name they do not own.
 *
 * **Issuing the certificate is not ours and is not done here.** We check that the records
 * are in place and say so; Certificate Manager issues on the authorisation record when the
 * infrastructure exists. `verified` therefore means the DNS is right, which is exactly what
 * these two lookups can prove and no more.
 */
@Injectable()
export class DomainsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
    private readonly dns: DnsVerifier,
  ) {}

  async list(context: OrgContext, projectId: string): Promise<ProjectDomain[]> {
    const tenant = await this.scope.of(context, projectId);
    const rows = await this.uow.run(tenant, (tx) =>
      new ProjectDomainRepository(tx, tenant).list(ProjectDomainType.Auth),
    );
    return rows.map(present);
  }

  /**
   * Claims a hostname and mints the records for it.
   *
   * The token is generated here and stored in the record, never derived from the domain: a
   * predictable authorisation value would let somebody publish the record for a name they
   * are about to claim rather than one they already control.
   */
  async add(context: OrgContext, projectId: string, domain: string): Promise<ProjectDomain> {
    const tenant = await this.scope.of(context, projectId);
    const token = generateOpaqueToken(16);
    const records: DomainDnsRecord[] = [
      { kind: "cname", name: domain, value: LOAD_BALANCER_TARGET, status: "pending" },
      {
        kind: "cert",
        name: `${CERT_AUTH_PREFIX}.${domain}`,
        value: `${token}.authorize.certificatemanager.goog`,
        status: "pending",
      },
    ];

    try {
      const row = await this.uow.run(tenant, (tx) =>
        new ProjectDomainRepository(tx, tenant).add({
          domain,
          type: ProjectDomainType.Auth,
          records,
        }),
      );
      return present(row);
    } catch (cause: unknown) {
      // The unique index fires for a name this project already added and for one another
      // project holds, and the answer is the same either way. Saying which would tell a
      // stranger whether a hostname is already a customer of ours.
      if (cause instanceof ResourceConflictError) {
        throw new ResourceConflictError({
          message: "That hostname is already claimed.",
          detail: { domain },
          cause,
        });
      }
      throw cause;
    }
  }

  /**
   * Resolves the records and writes down what was found.
   *
   * Verified only when every record resolves. A partial result stays `failed` rather than
   * becoming a half-verified state nothing downstream knows how to read:
   * `resolve_project_by_host` routes on `verified` alone, so anything short of it must not
   * be it.
   */
  async verify(context: OrgContext, projectId: string, domainId: string): Promise<ProjectDomain> {
    const tenant = await this.scope.of(context, projectId);
    const id = PublicId.parse(IdPrefix.Domain, domainId).uuid;

    const existing = await this.uow.run(tenant, (tx) =>
      new ProjectDomainRepository(tx, tenant).findById(id),
    );
    if (existing === null) throw new ResourceNotFoundError({ detail: { domainId } });

    // Outside the transaction: DNS is a network call that can take seconds, and holding a
    // database transaction open across one ties up a pooled connection for no reason.
    const checked = await this.dns.check(existing.records);
    const status = checked.every((record) => record.status === "found")
      ? ProjectDomainStatus.Verified
      : ProjectDomainStatus.Failed;

    const row = await this.uow.run(tenant, (tx) =>
      new ProjectDomainRepository(tx, tenant).recordCheck(id, status, checked, new Date()),
    );
    if (row === null) throw new ResourceNotFoundError({ detail: { domainId } });
    return present(row);
  }

  async remove(context: OrgContext, projectId: string, domainId: string): Promise<void> {
    const tenant = await this.scope.of(context, projectId);
    const id = PublicId.parse(IdPrefix.Domain, domainId).uuid;
    const removed = await this.uow.run(tenant, (tx) =>
      new ProjectDomainRepository(tx, tenant).remove(id),
    );
    if (!removed) throw new ResourceNotFoundError({ detail: { domainId } });
  }
}

function present(row: ProjectDomainRow): ProjectDomain {
  return {
    id: PublicId.encode(IdPrefix.Domain, row.id).value,
    domain: row.domain,
    type: row.type,
    status: row.status,
    records: row.records.map((record) => ({ ...record })),
    checkedAt: row.checkedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
