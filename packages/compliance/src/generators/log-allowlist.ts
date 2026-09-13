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
    // Operational fields that are not columns: process identity and startup config.
    // These are declared here rather than left to be dropped, because a boot line that
    // logs nothing but "droppedFields: 5" is how an allowlist earns a bad reputation.
    "env",
    "cell",
    // Which service wrote the line. Bound once at boot and never per line, so it survives a
    // `component` that names a subsystem.
    "service",
    "port",
    "logLevel",
    "accessTokenTtlSeconds",
    "status",
    "component",
    "droppedFields",
    // Counters and the names of our own infrastructure. None of these can carry a value out
    // of a row: `attempt`, `failures` and `count` are integers the process computed, and
    // `queue` is a Cloud Tasks queue we named in Terraform. They are here because the lines
    // that carry them are the webhook pipeline's only readable trace — "delivery attempted"
    // without the attempt number is a line nobody can act on (ADR-0012).
    "attempt",
    "failures",
    "count",
    "queue",
    // The class of a fatal error, which is a type name and never data. Its *message* is
    // deliberately absent: that is the one field on an exception that can quote a value,
    // and a driver error naming the row it choked on is exactly what must not be logged.
    // `errorCode` above carries the stable code, which is what a reader actually greps.
    "errorName",
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
