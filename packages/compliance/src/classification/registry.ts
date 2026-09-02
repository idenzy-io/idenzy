import type { ColumnClassification } from "./vocabulary.js";

export type TableClassification = Readonly<Record<string, ColumnClassification>>;

const registry = new Map<string, TableClassification>();

/** Called by `classifiedTable` at module load. Not for direct use. */
export function registerTable(table: string, columns: TableClassification): void {
  registry.set(table, columns);
}

/**
 * Every classified table, in declaration order.
 *
 * Importing the schema module is what populates this, so a generator must import the
 * schema before reading the registry.
 */
export function classificationRegistry(): ReadonlyMap<string, TableClassification> {
  return registry;
}

/** Test helper. Never call this from application code. */
export function resetRegistryForTesting(): void {
  registry.clear();
}
