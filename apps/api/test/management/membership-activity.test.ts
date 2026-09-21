import { describe, expect, it } from "vitest";
import { isStale } from "../../dist/management/tenancy/membership.guard.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);

/**
 * The bound on the activity stamp, on its own.
 *
 * It is a pure function and tested as one because it is the whole of the decision: every
 * dashboard request under `/v1/orgs/:orgId` asks it, and getting it wrong in the cheap
 * direction is an UPDATE on the busiest row in the control plane per request, while
 * getting it wrong in the other is a members screen that says "Never signed in" about
 * whoever is reading it.
 */
describe("bounding the activity stamp", () => {
  it("stamps a member who has never been seen", () => {
    expect(isStale(null, NOW)).toBe(true);
  });

  it("does not stamp again within the day", () => {
    expect(isStale(new Date(NOW - 1000), NOW)).toBe(false);
    expect(isStale(new Date(NOW - DAY + 1000), NOW)).toBe(false);
  });

  it("stamps again once a day has passed", () => {
    expect(isStale(new Date(NOW - DAY), NOW)).toBe(true);
    expect(isStale(new Date(NOW - 30 * DAY), NOW)).toBe(true);
  });

  /**
   * A rolling window and not a calendar day, so the rate does not depend on a timezone
   * nobody chose: on a calendar boundary a member working either side of local midnight
   * is stamped twice within an hour.
   */
  it("measures a rolling day rather than a calendar one", () => {
    const justBeforeMidnight = Date.UTC(2026, 8, 13, 23, 59, 0);
    const justAfter = Date.UTC(2026, 8, 14, 0, 1, 0);
    expect(isStale(new Date(justBeforeMidnight), justAfter)).toBe(false);
  });

  /**
   * A clock that has gone backwards — a correction, or a replica a little behind — must
   * not read as a stale stamp and start writing on every request.
   */
  it("does not stamp on a timestamp from the future", () => {
    expect(isStale(new Date(NOW + DAY), NOW)).toBe(false);
  });
});
