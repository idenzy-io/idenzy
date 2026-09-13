import { registerTable } from "@idenzy/compliance/classification/registry";
import type { ColumnClassification, Retention } from "@idenzy/compliance/classification/vocabulary";
import { ServerError } from "@idenzy/core/errors/status-errors";
import { ErrorCode } from "@idenzy/protocol/errors/codes";

declare const CLASSIFIED: unique symbol;

/** A ClickHouse column that has been through `column()`. */
export interface AnalyticsColumn {
  readonly type: string;
  readonly classification: ColumnClassification;
  readonly [CLASSIFIED]: true;
}

/**
 * How long a tier is kept, as a ClickHouse `INTERVAL` (PROJECT.md 4.13).
 *
 * Only the tiers an analytics row can plausibly carry are here. A retention this cannot express
 * is not a retention this store can enforce, and a table asking for one fails at module load
 * rather than being created with no TTL at all — which is the shape that silently keeps
 * everything forever while a data map says otherwise.
 */
const TTL_INTERVALS: Partial<Record<Retention, string>> = {
  hours_72: "INTERVAL 72 HOUR",
  days_30: "INTERVAL 30 DAY",
  months_6: "INTERVAL 6 MONTH",
  years_1: "INTERVAL 1 YEAR",
  years_2: "INTERVAL 2 YEAR",
  years_6: "INTERVAL 6 YEAR",
};

export interface AnalyticsTableOptions {
  /**
   * How long a row lives, and the only place it is stated.
   *
   * Table-level rather than per column, unlike the Drizzle side, and that is not a simplification:
   * ClickHouse drops a row, so a data map claiming one column is kept six months while the row
   * that holds it goes at thirty days would be describing something the engine cannot do. Every
   * column's classification must agree with this, and `classifiedAnalyticsTable` refuses at module
   * load when one does not.
   */
  readonly retention: Retention;
  /** The sort key. `project_id` first on every table, because every read is scoped by it. */
  readonly orderBy: readonly string[];
  /** Monthly, so retention drops partitions rather than mutating rows. */
  readonly partitionBy: string;
  /** The column the TTL is measured from. */
  readonly ttlColumn: string;
}

/** A declared analytics table: its DDL, its row policy, and what it holds. */
export interface AnalyticsTable {
  readonly name: string;
  readonly columns: Readonly<Record<string, AnalyticsColumn>>;
  readonly options: AnalyticsTableOptions;
  /** `CREATE TABLE IF NOT EXISTS`, fully qualified by the caller's database. */
  createTable(database: string): string;
  /** `CREATE ROW POLICY`, which is the second line of ADR-0013 and never optional. */
  createRowPolicy(database: string, user: string, setting: string): string;
}

/**
 * Declares what an analytics column holds, why, and for how long (PROJECT.md 4.13.2).
 *
 * The Drizzle twin of this brands a column builder; there is no builder here, so the brand is on
 * the descriptor itself and `column()` is the only thing that can produce one. An unclassified
 * analytics column is therefore not a lint warning or a runtime check — it is a value that cannot
 * be constructed, which is the same guarantee `classified()` gives on the Postgres side and for
 * the same reason: a column that escapes these declarations escapes the RoPA, the data map, the
 * log allowlist and the DSR field lists at once.
 */
export function column(type: string, classification: ColumnClassification): AnalyticsColumn {
  // Safe: the brand is a phantom property carrying no runtime value, and this function is the
  // only place it is ever applied.
  return { type, classification } as AnalyticsColumn;
}

/**
 * A ClickHouse table whose every column is classified and whose retention is enforceable.
 *
 * Registered into the same classification registry the Drizzle schema uses, under an
 * `analytics.` prefix, so the compliance generators reach it without learning a second source —
 * which is what todo.md 3.2 asked for. The prefix is not decoration: it keeps a ClickHouse table
 * from colliding with a Postgres one of the same name, and it tells a reader of the data map
 * which store an answer came from.
 */
export function classifiedAnalyticsTable(
  name: string,
  columns: Readonly<Record<string, AnalyticsColumn>>,
  options: AnalyticsTableOptions,
): AnalyticsTable {
  const ttl = TTL_INTERVALS[options.retention];
  if (ttl === undefined) throw new UnenforceableRetentionError(name, options.retention);

  for (const [property, declared] of Object.entries(columns)) {
    if (declared.classification.retention !== options.retention) {
      throw new RetentionMismatchError(name, property, options.retention);
    }
  }
  if (!(options.ttlColumn in columns)) throw new MissingTtlColumnError(name, options.ttlColumn);

  registerTable(
    `analytics.${name}`,
    Object.fromEntries(
      Object.entries(columns).map(([property, declared]) => [property, declared.classification]),
    ),
  );

  return {
    name,
    columns,
    options,
    createTable(database) {
      const definitions = Object.entries(columns).map(
        ([property, declared]) => `  ${property} ${declared.type}`,
      );
      return [
        `CREATE TABLE IF NOT EXISTS ${database}.${name} (`,
        definitions.join(",\n"),
        `) ENGINE = MergeTree`,
        `PARTITION BY ${options.partitionBy}`,
        `ORDER BY (${options.orderBy.join(", ")})`,
        `TTL ${options.ttlColumn} + ${ttl}`,
        // Dropping a whole part is what makes retention cheap. Without this ClickHouse rewrites
        // parts to remove expired rows, which is a mutation over the whole table on a schedule.
        `SETTINGS ttl_only_drop_parts = 1`,
      ].join("\n");
    },
    createRowPolicy(database, user, setting) {
      return [
        `CREATE ROW POLICY IF NOT EXISTS ${name}_tenant ON ${database}.${name}`,
        `  USING project_id = toUUID(getSetting('${setting}'))`,
        `  TO ${user}`,
      ].join("\n");
    },
  };
}

/** Raised at module load, so the process does not start with a table it cannot age out. */
export class UnenforceableRetentionError extends ServerError {
  override readonly code = ErrorCode.Internal;
  constructor(table: string, retention: Retention) {
    super(`Analytics table "${table}" asks for a retention this store cannot enforce.`, {
      detail: { table, retention, rule: "PROJECT.md 4.13" },
    });
  }
}

/**
 * A column claiming a different lifetime from the row that holds it.
 *
 * ClickHouse drops rows, so the two cannot disagree in fact — only in the data map, which is the
 * document a customer is shown.
 */
export class RetentionMismatchError extends ServerError {
  override readonly code = ErrorCode.Internal;
  constructor(table: string, column: string, retention: Retention) {
    super(`Column "${table}.${column}" declares a retention its table does not.`, {
      detail: { table, column, tableRetention: retention, rule: "PROJECT.md 4.13.2" },
    });
  }
}

export class MissingTtlColumnError extends ServerError {
  override readonly code = ErrorCode.Internal;
  constructor(table: string, ttlColumn: string) {
    super(`Analytics table "${table}" measures its TTL from a column it does not have.`, {
      detail: { table, ttlColumn },
    });
  }
}
