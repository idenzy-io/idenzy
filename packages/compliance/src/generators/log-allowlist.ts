import { classificationRegistry } from "../classification/registry.js";

/**
 * Field names a structured log line may contain (PROJECT.md 4.13.8).
 *
 * An allowlist, not a blocklist: blocklists fail silently the day someone adds a
 * column, allowlists fail closed. A column is loggable only if it says so, and no
 * pii, phi or secret column can opt in.
 */
export function generateLogAllowlist(): ReadonlySet<string> {
  const allowed = new Set<string>([
    // Request and trace context, never derived from a column.
    "requestId",
    "traceId",
    "spanId",
    "projectId",
    "sessionId",
    "actorType",
    "method",
    "path",
    "statusCode",
    "durationMs",
    "errorCode",
    "provider",
    "channel",
    "outcome",
  ]);

  for (const columns of classificationRegistry().values()) {
    for (const [name, c] of Object.entries(columns)) {
      if (c.loggable === true) allowed.add(name);
    }
  }
  return allowed;
}

/** Columns that must never be logged. Used to assert the allowlist has no overlap. */
export function forbiddenLogFields(): ReadonlySet<string> {
  const forbidden = new Set<string>();
  for (const columns of classificationRegistry().values()) {
    for (const [name, c] of Object.entries(columns)) {
      if (c.loggable !== true && (c.class === "pii" || c.class === "phi" || c.class === "secret")) {
        forbidden.add(name);
      }
    }
  }
  return forbidden;
}
