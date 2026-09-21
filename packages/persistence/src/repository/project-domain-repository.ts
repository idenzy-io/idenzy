import { ResourceConflictError } from "@idenzy/core/errors";
import type { ProjectDomainStatus, ProjectDomainType } from "@idenzy/protocol/enums/tenancy";
import { and, asc, eq } from "drizzle-orm";
import { projectDomains } from "../schema/projects.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";

/** One record a customer has to create, as the screen lists it. */
export interface DomainDnsRecord {
  /** `cname` routes traffic; `cert` is what authorises the certificate. */
  readonly kind: "cname" | "cert";
  /** Fully qualified, as a DNS console wants it. */
  readonly name: string;
  readonly value: string;
  readonly status: "pending" | "found" | "missing";
}

export interface ProjectDomainRow {
  readonly id: string;
  readonly domain: string;
  readonly type: ProjectDomainType;
  readonly status: ProjectDomainStatus;
  readonly records: readonly DomainDnsRecord[];
  readonly checkedAt: Date | null;
  readonly createdAt: Date;
}

export interface NewProjectDomain {
  readonly domain: string;
  readonly type: ProjectDomainType;
  readonly records: readonly DomainDnsRecord[];
}

function toRow(row: typeof projectDomains.$inferSelect): ProjectDomainRow {
  return {
    id: row.id,
    domain: row.domain,
    // Safe: both columns are written only from the protocol enums.
    type: row.type as ProjectDomainType,
    status: row.status as ProjectDomainStatus,
    records: readRecords(row.dnsRecords),
    checkedAt: row.checkedAt,
    createdAt: row.createdAt,
  };
}

/**
 * `jsonb` is typed `unknown`, correctly: the database guarantees valid JSON and no more.
 * Narrowed once, here, so nothing downstream asserts — and a row written by an older
 * version with a shape we no longer recognise reads as an empty list rather than throwing
 * in the middle of a screen.
 */
function readRecords(value: unknown): DomainDnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const { kind, name, value: target, status } = record;
    if (typeof name !== "string" || typeof target !== "string") return [];
    return [
      {
        kind: kind === "cert" ? "cert" : "cname",
        name,
        value: target,
        status: status === "found" || status === "missing" ? status : "pending",
      } as const,
    ];
  });
}

/**
 * The custom hostnames a project has claimed (PROJECT.md 4.3, 4.7).
 *
 * An auth domain is a precondition rather than a convenience: `SameSite` is a site rule,
 * so cookie mode only works once the auth API is same-site with the customer's app. That
 * is the whole reason this table exists, and why `resolve_project_by_host` will only route
 * to a row whose status is `verified`.
 *
 * The unique index is across every project, not per project, and it has to be: a hostname
 * that resolved to two projects would make routing ambiguous, and the resolution function
 * would have two answers to a question with one.
 */
export class ProjectDomainRepository extends BaseRepository<typeof projectDomains> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, projectDomains);
  }

  async list(type: ProjectDomainType): Promise<ProjectDomainRow[]> {
    const rows = await this.tx
      .select()
      .from(projectDomains)
      .where(and(this.tenantScope(), eq(projectDomains.type, type)))
      .orderBy(asc(projectDomains.createdAt));
    return rows.map(toRow);
  }

  async findById(id: string): Promise<ProjectDomainRow | null> {
    const rows = await this.tx
      .select()
      .from(projectDomains)
      .where(and(this.tenantScope(), eq(projectDomains.id, id)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Claims a hostname for this project.
   *
   * A conflict here is the unique index doing its job, and it covers the case where
   * another project claimed the same name first. The caller turns that into a refusal the
   * reader can act on; it is deliberately not resolved by taking the name over, because a
   * claim that could be taken over is not a claim.
   */
  async add(domain: NewProjectDomain): Promise<ProjectDomainRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(projectDomains)
        .values({
          projectId: this.context.projectId,
          domain: domain.domain,
          type: domain.type,
          dnsRecords: domain.records,
        })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceConflictError({ detail: { domain: domain.domain } });
    return toRow(row);
  }

  /** What a DNS check found: the per-record results, the status they add up to, and when. */
  async recordCheck(
    id: string,
    status: ProjectDomainStatus,
    records: readonly DomainDnsRecord[],
    checkedAt: Date,
  ): Promise<ProjectDomainRow | null> {
    const rows = await this.tx
      .update(projectDomains)
      .set({ status, dnsRecords: records, checkedAt })
      .where(and(this.tenantScope(), eq(projectDomains.id, id)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  }

  /**
   * Removes a claim. A hard delete, unlike an API key.
   *
   * A key that signed requests is part of the record of what happened; a hostname that was
   * never verified is a claim somebody withdrew, and one that was is a routing entry that
   * has to stop routing. Neither leaves anything worth keeping, and a tombstoned row would
   * hold the unique name against the customer who wanted to re-add it.
   */
  async remove(id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(projectDomains)
      .where(and(this.tenantScope(), eq(projectDomains.id, id)))
      .returning({ id: projectDomains.id });
    return rows.length === 1;
  }
}
