import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface ErasedUser {
  readonly projectId: string;
  readonly userId: string;
}

export interface StrippedCopies {
  readonly outbox: number;
  readonly deliveries: number;
}

/**
 * The copies of an erased user's data that messaging made, stripped after the erasure.
 *
 * `erase_user` clears what the account is. What it cannot reach in the same transaction is what
 * was already written about the account to be sent somewhere: outbox events waiting for (or
 * past) their consumers, and webhook deliveries still holding a payload. Those keep their ids,
 * because a consumer may still need to route them, and lose every personal field — the event
 * still happened, it just no longer says who from where.
 *
 * One statement per store for a whole batch, across projects, which is why this is not a tenant
 * repository: an erasure relay that ran one per user would be one index walk per user, and a
 * customer deleting ten thousand accounts would wait on ten thousand of them. The pairs keep each
 * project's users to its own rows, though a user id is unique across projects anyway.
 *
 * `audit.recorded` is left alone on purpose. The trail keeps its pseudonymous actor and the
 * address it acted from as proof the erasure was performed (Art. 17(3)(b)), which is the
 * classification of `audit_events` and would be undone by stripping the event it is built from.
 */
export class ErasedUserCopies {
  constructor(private readonly db: NodePgDatabase) {}

  async strip(erased: readonly ErasedUser[], keys: readonly string[]): Promise<StrippedCopies> {
    if (erased.length === 0 || keys.length === 0) return { outbox: 0, deliveries: 0 };
    const projects = sql.param(erased.map((one) => one.projectId));
    const users = sql.param(erased.map((one) => one.userId));
    const published = sql.param(
      erased.map((one) => PublicId.encode(IdPrefix.User, one.userId).value),
    );
    const personal = sql.param([...keys]);

    // The predicates repeat the partial indexes' own (`payload ? 'userId'`, `payload is not
    // null`), which is what lets the planner use them.
    const outbox = await this.db.execute(
      sql`update outbox o
          set payload = o.payload - ${personal}::text[]
          from unnest(${projects}::uuid[], ${users}::text[]) as d(project_id, user_id)
          where o.project_id = d.project_id
            and o.payload ? 'userId'
            and o.payload->>'userId' = d.user_id
            and o.topic <> 'audit.recorded'
            and o.payload ?| ${personal}::text[]`,
    );
    const deliveries = await this.db.execute(
      sql`update webhook_deliveries w
          set payload = w.payload - ${personal}::text[],
              attempt_log = '[]'::jsonb
          from unnest(${projects}::uuid[], ${published}::text[]) as d(project_id, user_ref)
          where w.project_id = d.project_id
            and w.payload is not null
            and w.payload->>'user' = d.user_ref`,
    );
    return { outbox: outbox.rowCount ?? 0, deliveries: deliveries.rowCount ?? 0 };
  }
}
