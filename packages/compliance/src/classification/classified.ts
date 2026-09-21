import { ServerError } from "@idenzy/core/errors/status-errors";
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import type { BuildExtraConfigColumns } from "drizzle-orm";
import {
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  pgTable,
} from "drizzle-orm/pg-core";
import { registerSubject, registerTable } from "./registry.js";
import type { ColumnClassification, TableSubject } from "./vocabulary.js";

declare const CLASSIFIED: unique symbol;

/** A column builder that has been through `classified()`. */
export type ClassifiedBuilder<B extends PgColumnBuilderBase = PgColumnBuilderBase> = B & {
  readonly [CLASSIFIED]: true;
};

const classifications = new WeakMap<object, ColumnClassification>();

/**
 * Declares what a column holds, why, and for how long (PROJECT.md 4.13.2).
 *
 * The return type is branded, and `classifiedTable` accepts only branded builders, so
 * an unclassified column is a compile error rather than a lint warning. That is the
 * whole point: the RoPA, data map, log allowlist and DSR field lists are generated
 * from these declarations, and a column that escapes them escapes all four.
 */
export function classified<B extends PgColumnBuilderBase>(
  builder: B,
  classification: ColumnClassification,
): ClassifiedBuilder<B> {
  classifications.set(builder, classification);
  // Safe: the brand is a phantom type carrying no runtime value. The WeakMap above is
  // the real association, keyed by the same builder instance the caller passes on.
  return builder as ClassifiedBuilder<B>;
}

/** Shorthand for a column under field-level envelope encryption (PROJECT.md 4.13.4). */
export function encrypted<B extends PgColumnBuilderBase>(
  builder: B,
  classification: Omit<ColumnClassification, "encrypted">,
): ClassifiedBuilder<B> {
  return classified(builder, { ...classification, encrypted: true });
}

/**
 * `pgTable`, but every column must be classified.
 *
 * Use this for every tenant table. Reaching for `pgTable` directly bypasses the
 * compliance surface, which is why the schema lint flags it.
 */
export function classifiedTable<
  TName extends string,
  TColumns extends Record<string, ClassifiedBuilder>,
>(
  name: TName,
  columns: TColumns,
  extraConfig?: (self: BuildExtraConfigColumns<TName, TColumns, "pg">) => PgTableExtraConfigValue[],
  options: ClassifiedTableOptions = {},
) {
  const { registryPrefix = "", subject } = options;
  const entries = Object.entries(columns).map(([property, builder]) => {
    const classification = classifications.get(builder);
    if (classification === undefined) {
      // Unreachable through the public type, but a JS caller or a bad cast can get here.
      throw new UnclassifiedColumnError(name, property);
    }
    return [property, classification] as const;
  });
  const key = `${registryPrefix}${name}`;
  registerTable(key, Object.fromEntries(entries));
  if (subject !== undefined) registerSubject(key, subject);

  return pgTable(name, columns, extraConfig);
}

export interface ClassifiedTableOptions {
  /**
   * Qualifies the registry key only, never the Postgres table name. Defaults to none, so a cell
   * table — which is almost all of them — is recorded under its bare name as it always was.
   */
  readonly registryPrefix?: string;
  /**
   * Whose personal data this table holds and how to reach one person's rows (4.13.6).
   *
   * Required of any table carrying a `subjectField` column, and asserted by a test rather than by
   * the type system: the column flags are per column and this is per table, so the compiler cannot
   * see the pair. Omit it for a table holding nobody's personal data, which is most of them.
   */
  readonly subject?: TableSubject;
}

/**
 * The registry prefix a control-plane table is recorded under.
 *
 * The Postgres table is still `orgs`; only the key in the classification registry is qualified.
 * `classifiedAnalyticsTable` already does exactly this with `analytics.`, for two reasons that
 * apply here word for word: two stores cannot collide in one flat name-keyed map, and a reader of
 * the generated data map can tell which store an answer came from.
 *
 * The second reason is the one that matters for residency. A cell is an independent stack per
 * PROJECT.md 4.13.5, so "which plane is this table in" is the same question as "which
 * jurisdiction does this column live in" — and the data map had no way to express it. The
 * generators need no change to gain the axis: `data-map.ts` sorts by registry key, so prefixed
 * tables group themselves.
 */
const CONTROL_PLANE_PREFIX = "control.";

/**
 * `classifiedTable`, for a table that lives in the global control plane rather than in a cell.
 *
 * Org-keyed tables and the two registries that are keyed on nothing: billing, the organisation
 * and its members, `region_cells`, `staff_access_grants`. What separates them from everything
 * else is that they do **not** move when a second cell is provisioned, which is why they are the
 * ones that must be identifiable as a group before that happens.
 */
export function controlTable<
  TName extends string,
  TColumns extends Record<string, ClassifiedBuilder>,
>(
  name: TName,
  columns: TColumns,
  extraConfig?: (self: BuildExtraConfigColumns<TName, TColumns, "pg">) => PgTableExtraConfigValue[],
  subject?: TableSubject,
) {
  return classifiedTable(name, columns, extraConfig, {
    registryPrefix: CONTROL_PLANE_PREFIX,
    ...(subject === undefined ? {} : { subject }),
  });
}

/**
 * Thrown only when the compile-time brand has been bypassed. Raised at module load,
 * so it crashes the process at boot rather than surfacing as a request failure.
 */
export class UnclassifiedColumnError extends ServerError {
  override readonly code = ErrorCode.Internal;
  constructor(table: string, column: string) {
    super(`Column "${table}.${column}" was not declared through classified().`, {
      detail: { table, column, rule: "PROJECT.md 4.13.2" },
    });
  }
}
