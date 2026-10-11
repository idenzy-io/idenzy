import type { AppConfig } from "@idenzy/config/app-config";
import { ValidationFailedError } from "@idenzy/core/errors";

export interface AnalyticsSettings {
  readonly url: string;
  readonly database: string;
  readonly ingestUser: string;
  readonly ownerUser: string;
  readonly appUser: string;
  readonly eraserUser: string;
  readonly password: string;
}

/** All of them or none, so a half-configured store cannot become a silently disabled one. */
const REQUIRED = [
  "CLICKHOUSE_URL",
  "CLICKHOUSE_DATABASE",
  "CLICKHOUSE_USER",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_INGEST_USER",
  "CLICKHOUSE_OWNER_USER",
  "CLICKHOUSE_ERASER_USER",
] as const;

/**
 * The analytics store's settings, or null for a deployment that has none.
 *
 * Null is a correct deployment and not a degraded one: nothing on the authentication path reads
 * this store, so a cell without one serves sign-ins and draws no charts. What is *not* correct is
 * a deployment with some of these — it would start, run with ingestion quietly switched off, and
 * the symptom would be an empty chart nobody is watching rather than an error anybody sees. Same
 * shape and same reasoning as `CloudTasksScheduler.settingsFrom` (ADR-0012).
 *
 * Three identities from one password, which is a local-development convenience and is stated
 * rather than hidden: a real cell gives each of them its own secret, because the whole point of
 * separating a reader from a writer is lost if one leak hands over both.
 */
export function analyticsSettingsFrom(config: AppConfig): AnalyticsSettings | null {
  const given = REQUIRED.filter((key) => config.get(key) !== undefined);
  if (given.length === 0) return null;
  if (given.length < REQUIRED.length) {
    throw new ValidationFailedError({
      message: "The analytics store is only half configured.",
      fields: REQUIRED.filter((key) => config.get(key) === undefined).map((key) => ({
        path: key,
        code: "required_with_siblings",
      })),
    });
  }

  return {
    url: config.get("CLICKHOUSE_URL") ?? "",
    database: config.get("CLICKHOUSE_DATABASE") ?? "",
    appUser: config.get("CLICKHOUSE_USER") ?? "",
    ingestUser: config.get("CLICKHOUSE_INGEST_USER") ?? "",
    ownerUser: config.get("CLICKHOUSE_OWNER_USER") ?? "",
    eraserUser: config.get("CLICKHOUSE_ERASER_USER") ?? "",
    password: config.get("CLICKHOUSE_PASSWORD") ?? "",
  };
}
