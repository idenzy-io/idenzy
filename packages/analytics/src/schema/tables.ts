import { authEvents } from "./auth-events.js";
import type { AnalyticsTable } from "./classified-table.js";

/**
 * Every analytics table, which is what the migrator creates and what the isolation test sweeps.
 *
 * A list rather than a lookup by name, because the two things that read it both want all of them:
 * a new table with no row policy reads every project's rows and errors nowhere (ADR-0013), so a
 * table that is missing from here is the one failure this design has.
 */
export const ANALYTICS_TABLES: readonly AnalyticsTable[] = [authEvents];

/** Named so a producer does not spell the table out and drift from what was declared. */
export const AUTH_EVENTS_TABLE = authEvents.name;
