import type { AppConfig } from "@idenzy/config/app-config";
import { ValidationFailedError } from "@idenzy/core/errors";

export interface AnalyticsSettings {
  readonly url: string;
  readonly database: string;
  readonly ingestUser: string;
  readonly ownerUser: string;
  readonly appUser: string;
  readonly eraserUser: string;
  /** Each identity's own password: the reader's for nothing here, the rest for what they run. */
  readonly passwords: {
    readonly ingest: string;
    readonly owner: string;
    readonly eraser: string;
  };
}

/**
 * The write, DDL and erasure identities' passwords, one each.
 *
 * Outside development each must be set and none may be the reader's: four identities behind one
 * password are one identity, and the reason they are separate — the reader cannot write, the writer
 * cannot read, the eraser can only delete — would hold only until that password leaked. Locally
 * one password opens all four, which is what the development roles script creates.
 */
const SEPARATE_PASSWORDS = [
  "CLICKHOUSE_INGEST_PASSWORD",
  "CLICKHOUSE_OWNER_PASSWORD",
  "CLICKHOUSE_ERASER_PASSWORD",
] as const;

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
    passwords: passwordsFrom(config),
  };
}

function passwordsFrom(config: AppConfig): AnalyticsSettings["passwords"] {
  const shared = config.get("CLICKHOUSE_PASSWORD") ?? "";
  if (config.get("IDENZY_ENV") === "development") {
    return {
      ingest: config.get("CLICKHOUSE_INGEST_PASSWORD") ?? shared,
      owner: config.get("CLICKHOUSE_OWNER_PASSWORD") ?? shared,
      eraser: config.get("CLICKHOUSE_ERASER_PASSWORD") ?? shared,
    };
  }
  const shortfall = SEPARATE_PASSWORDS.filter((key) => {
    const value = config.get(key);
    return value === undefined || value === shared;
  });
  if (shortfall.length > 0) {
    throw new ValidationFailedError({
      message: "Each analytics identity needs its own password.",
      fields: shortfall.map((key) => ({ path: key, code: "required_and_distinct" })),
    });
  }
  return {
    ingest: config.get("CLICKHOUSE_INGEST_PASSWORD") ?? "",
    owner: config.get("CLICKHOUSE_OWNER_PASSWORD") ?? "",
    eraser: config.get("CLICKHOUSE_ERASER_PASSWORD") ?? "",
  };
}
