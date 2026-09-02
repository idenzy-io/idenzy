import { ServerError } from "@idenzy/core/errors/status-errors";
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import type { BuildExtraConfigColumns } from "drizzle-orm";
import {
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  pgTable,
} from "drizzle-orm/pg-core";
import { registerTable } from "./registry.js";
import type { ColumnClassification } from "./vocabulary.js";

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
) {
  const entries = Object.entries(columns).map(([property, builder]) => {
    const classification = classifications.get(builder);
    if (classification === undefined) {
      // Unreachable through the public type, but a JS caller or a bad cast can get here.
      throw new UnclassifiedColumnError(name, property);
    }
    return [property, classification] as const;
  });
  registerTable(name, Object.fromEntries(entries));

  return pgTable(name, columns, extraConfig);
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
