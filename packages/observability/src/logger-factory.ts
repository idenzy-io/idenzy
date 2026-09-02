import { generateLogAllowlist } from "@idenzy/compliance/generators/log-allowlist";
import type { Logger } from "@idenzy/core/logging/logger";
import { pino } from "pino";
import { AllowlistLogger } from "./allowlist-logger.js";

export interface LoggerOptions {
  readonly level: string;
  readonly pretty?: boolean;
  readonly base?: Readonly<Record<string, unknown>>;
}

/**
 * Builds the application logger.
 *
 * The allowlist is read from the schema classification at construction, so adding a
 * loggable column changes what can be logged without touching this file.
 */
export function createLogger(options: LoggerOptions): Logger {
  const instance = pino({
    level: options.level,
    base: { ...options.base },
    // Nothing here is derived from a database column, so it is safe by construction.
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return new AllowlistLogger(instance, generateLogAllowlist());
}
