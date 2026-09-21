import { InternalError } from "@idenzy/core/errors";
import { retentionPolicies } from "../schema/compliance.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** One stored override. A subject with no row here is swept at the default. */
export interface RetentionPolicyRow {
  readonly subject: string;
  readonly maxAge: string;
  readonly action: string;
}

/**
 * A project's retention overrides (PROJECT.md 4.13.6).
 *
 * Overrides and not the whole answer, which is the shape worth understanding: a subject with
 * no row here is not a subject with no retention, it is one swept at the default. The sweeper
 * resolves that in SQL, so there is no moment where a project created before this existed —
 * or one whose owner never opened the settings screen — is kept forever.
 *
 * That is also why nothing writes default rows at creation. It would look tidier and it ages
 * badly: the day a default changes, every project made before it keeps the old number, and
 * nothing on the screen would say why two projects with identical settings sweep differently.
 */
export class RetentionPolicyRepository extends BaseRepository<typeof retentionPolicies> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, retentionPolicies);
  }

  async list(): Promise<readonly RetentionPolicyRow[]> {
    const rows = await this.guard(() =>
      this.tx
        .select({
          subject: retentionPolicies.subject,
          maxAge: retentionPolicies.maxAge,
          action: retentionPolicies.action,
        })
        .from(retentionPolicies)
        .where(this.tenantScope()),
    );
    return rows;
  }

  /**
   * Stores one age, replacing whatever was there.
   *
   * The conflict target is the unique index from 0051 rather than a read followed by a write:
   * two operators saving different ages for one subject in the same second would otherwise
   * both insert, and the sweeper would use whichever its subquery reached first.
   */
  async set(subject: string, maxAge: string, action: string): Promise<RetentionPolicyRow> {
    const [row] = await this.guard(() =>
      this.tx
        .insert(retentionPolicies)
        .values({ projectId: this.context.projectId, subject, maxAge, action })
        .onConflictDoUpdate({
          target: [retentionPolicies.projectId, retentionPolicies.subject],
          set: { maxAge, action },
        })
        .returning({
          subject: retentionPolicies.subject,
          maxAge: retentionPolicies.maxAge,
          action: retentionPolicies.action,
        }),
    );
    // Unreachable: an upsert with a conflict target either inserts or updates, and both
    // return. Asserted rather than assumed so a change to the target is a failure here.
    if (row === undefined) {
      throw new InternalError({
        detail: { subject, reason: "retention policy upsert returned no row" },
      });
    }
    return row;
  }
}
