import { eq, sql } from "drizzle-orm";
import { projectSpendState } from "../schema/usage.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface SpendState {
  readonly spendable: boolean;
  readonly reason: string;
  readonly computedAt: Date;
  readonly staleAfter: Date;
}

/**
 * The cell's own copy of whether its organisation may still spend (ADR-0016).
 *
 * A tenant repository like any other, which is the point: reading it is one indexed lookup inside
 * the transaction the request already has, against a table in the project's own cell. What it
 * replaced was three reads across the plane boundary on the send path.
 */
export class ProjectSpendStateRepository extends BaseRepository<typeof projectSpendState> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, projectSpendState);
  }

  /** The last decision the drawdown published, or null if it has never published one. */
  async current(): Promise<SpendState | null> {
    const rows = await this.tx
      .select()
      .from(projectSpendState)
      .where(eq(projectSpendState.projectId, this.context.projectId))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          spendable: row.spendable,
          reason: row.reason,
          computedAt: row.computedAt,
          staleAfter: row.staleAfter,
        };
  }

  /**
   * Publishes a decision, and writes nothing when nothing changed.
   *
   * An upsert whose update only applies when the decision differs from the one stored, or when
   * the stored one is past half its life. The drawdown publishes for every project on every pass,
   * and rewriting an identical row each time is a dead tuple per project per pass for nothing; the
   * half-life refresh is what keeps an unchanged decision from ever reaching `stale_after` and
   * failing open while the drawdown is healthy.
   */
  async publish(state: SpendState): Promise<void> {
    const midpoint = new Date(
      state.computedAt.getTime() + (state.staleAfter.getTime() - state.computedAt.getTime()) / 2,
    );
    await this.tx
      .insert(projectSpendState)
      .values({
        projectId: this.context.projectId,
        spendable: state.spendable,
        reason: state.reason,
        computedAt: state.computedAt,
        staleAfter: state.staleAfter,
      })
      .onConflictDoUpdate({
        target: projectSpendState.projectId,
        set: {
          spendable: state.spendable,
          reason: state.reason,
          computedAt: state.computedAt,
          staleAfter: state.staleAfter,
        },
        setWhere: sql`${projectSpendState.spendable} <> ${state.spendable}
          or ${projectSpendState.reason} <> ${state.reason}
          or ${projectSpendState.staleAfter} < ${midpoint.toISOString()}::timestamptz`,
      });
  }
}
