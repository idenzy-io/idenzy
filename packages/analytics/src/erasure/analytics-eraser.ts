import { Erasure } from "@idenzy/compliance/classification/vocabulary";
import { ValidationFailedError } from "@idenzy/core/errors";
import type { ClickHouseClient } from "../client/clickhouse-client.js";
import type { AnalyticsTable } from "../schema/classified-table.js";
import { ANALYTICS_TABLES } from "../schema/tables.js";

export interface ErasedSubject {
  readonly projectId: string;
  readonly userId: string;
}

/**
 * The tables an erasure deletes rows from: those whose `user_id` is classified `RowDeleted`.
 *
 * Read off the classification rather than listed, so a table added with a user column that says
 * its rows go is erased without anybody remembering this file.
 */
export const ERASABLE_ANALYTICS_TABLES: readonly AnalyticsTable[] = ANALYTICS_TABLES.filter(
  (table) => table.columns["user_id"]?.classification.erasure === Erasure.RowDeleted,
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Removes erased users' rows from the analytics store (ADR-0013, PROJECT.md 4.13.6).
 *
 * A mutation rather than a lightweight `DELETE`, because the point is that the bytes go: a
 * lightweight delete only masks rows until a merge that, for a month nobody writes to any more,
 * may never come. A mutation rewrites the parts that hold them. It is the heavier operation,
 * which is why one runs per batch of erasures and never per user.
 *
 * It runs as the erasure identity, which holds ALTER DELETE and nothing else, and the ids are
 * checked to be uuids before they are written into the statement: a mutation takes no query
 * parameters in every version we run, and a value that is not a uuid has no business here.
 */
export class AnalyticsEraser {
  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly database: string,
  ) {}

  async erase(subjects: readonly ErasedSubject[]): Promise<void> {
    if (subjects.length === 0) return;
    const pairs = subjects
      .map((one) => `(toUUID('${uuid(one.projectId)}'), toUUID('${uuid(one.userId)}'))`)
      .join(", ");
    for (const table of ERASABLE_ANALYTICS_TABLES) {
      await this.clickhouse.execute(
        `ALTER TABLE ${this.database}.${table.name} DELETE WHERE (project_id, user_id) IN (${pairs})`,
      );
    }
  }
}

function uuid(value: string): string {
  const normalized = value.toLowerCase();
  if (!UUID.test(normalized)) {
    throw new ValidationFailedError({
      message: "That identifier is not valid.",
      detail: { reason: "not a uuid" },
    });
  }
  return normalized;
}
