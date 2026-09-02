/**
 * Drizzle types a `jsonb` column as `unknown`, correctly: the database guarantees valid
 * JSON and nothing more. This narrows it at the one boundary where it is read, so no
 * caller has to assert.
 */
export function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}
