import type { StaffRole } from "@idenzy/protocol/enums/staff";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { operatorActions, staff } from "../schema/staff.js";

export interface StaffMember {
  readonly id: string;
  readonly email: string;
  readonly role: StaffRole;
}

export interface OperatorActionRecord {
  readonly staffId: string;
  readonly action: string;
  readonly orgId: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly reason: string;
}

/**
 * Who is an operator, as the application may ask it (ADR-0018).
 *
 * Reads only. The app role holds SELECT on `staff` and nothing else, so there is deliberately no
 * method here that could make anybody an operator; `StaffAdministration` does that, over the owner
 * connection, from the CLI. Not an `OrgRepository`: staff are ours, not a tenant's.
 */
export class StaffReader {
  constructor(private readonly db: NodePgDatabase) {}

  /** The active member of staff with this address, or null. Compared lower-case, as stored. */
  async activeByEmail(email: string): Promise<StaffMember | null> {
    const rows = await this.db
      .select({ id: staff.id, email: staff.email, role: staff.role })
      .from(staff)
      .where(and(eq(staff.email, email.toLowerCase()), eq(staff.active, true)))
      .limit(1);
    const row = rows[0];
    // Safe: the column is constrained to StaffRole's values by `staff_role_ck`.
    return row === undefined ? null : { ...row, role: row.role as StaffRole };
  }
}

/**
 * The operator audit trail's one writer (ADR-0018). Append-only by grant: nothing can amend a row.
 *
 * Takes a transaction handle, because a row here must commit with the change it records or not at
 * all — the caller passes the transaction the change runs in.
 */
export class OperatorActionLog {
  constructor(private readonly tx: Pick<NodePgDatabase, "insert">) {}

  async record(action: OperatorActionRecord): Promise<void> {
    await this.tx.insert(operatorActions).values({
      staffId: action.staffId,
      action: action.action,
      orgId: action.orgId,
      detail: sql`${JSON.stringify(action.detail)}::jsonb`,
      reason: action.reason,
    });
  }
}
