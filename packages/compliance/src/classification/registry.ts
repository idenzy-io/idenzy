import type { ColumnClassification, TableSubject } from "./vocabulary.js";

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
  subjects.clear();
}

const subjects = new Map<string, TableSubject>();

/** Called by `classifiedTable` for a table that holds somebody's personal data. */
export function registerSubject(table: string, subject: TableSubject): void {
  subjects.set(table, subject);
}

/**
 * How each table reaches a data subject, by the same key the classification registry uses.
 *
 * Separate from the column registry rather than folded into it because it answers a different
 * question — *how to find a person* rather than *what is held about them* — and because a table
 * holding no personal data correctly has no entry at all.
 */
export function subjectRegistry(): ReadonlyMap<string, TableSubject> {
  return subjects;
}
