import { Logger } from "@idenzy/core/logging/logger";
import { SystemClock } from "@idenzy/core/time/clock";
import type { DeliveryWindow } from "@idenzy/persistence/repository/email-delivery-stats-repository";
import { ProjectEmailActivityReader } from "@idenzy/persistence/repository/project-email-activity-reader";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { EmailReputationBreaker, ppm } from "../src/email/email-reputation-breaker.js";

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

/**
 * The verdict is a pure function of the window, so it is instantiated with collaborators it
 * never reaches: nothing below runs a pass, and a database here would only be a slower way
 * to assert arithmetic.
 */
const breaker = (options = {}) =>
  new EmailReputationBreaker(
    // Neither is reached. Every case calls `verdict`, which is pure, so the compiler is told
    // what the constructor wants and nothing here ever touches a socket. Running a pass is
    // the integration suite's job, where both are real.
    null as unknown as UnitOfWork,
    new ProjectEmailActivityReader(null as unknown as NodePgDatabase),
    new SystemClock(),
    new SilentLogger(),
    options,
  );

const window = (over: Partial<DeliveryWindow> = {}): DeliveryWindow => ({
  sent: 1_000,
  bounced: 0,
  complained: 0,
  ...over,
});

describe("rates in parts per million", () => {
  it("is exact at the thresholds it exists to compare against", () => {
    expect(ppm(5, 100)).toBe(50_000); // 5%, AWS's bounce review line
    expect(ppm(1, 1_000)).toBe(1_000); // 0.1%, AWS's complaint review line
  });

  /* A project with events and no sends is a pipeline fault, not a 100% bounce rate. */
  it("answers zero rather than dividing by nothing", () => {
    expect(ppm(4, 0)).toBe(0);
  });
});

/**
 * What stops a project sending (risks.md 2).
 *
 * The cost of being wrong is not symmetric, and the cases are chosen around that. Failing to
 * trip costs us reputation on an account every customer shares; tripping wrongly stops a
 * blameless customer's password resets. So the floor below matters as much as the thresholds.
 */
describe("judging a project's recent deliverability", () => {
  it("leaves a clean project alone", () => {
    const verdict = breaker().verdict(window({ bounced: 4, complained: 0 }));
    expect(verdict.breached).toBe(false);
    expect(verdict.bounceRatePpm).toBe(4_000);
  });

  it("holds a project at or past AWS's bounce line", () => {
    expect(breaker().verdict(window({ bounced: 49 })).breached).toBe(false);
    const verdict = breaker().verdict(window({ bounced: 50 }));
    expect(verdict.breached).toBe(true);
    expect(verdict.reason).toBe("bounce_rate");
  });

  it("holds a project at or past AWS's complaint line, which is fifty times tighter", () => {
    expect(breaker().verdict(window({ complained: 0 })).breached).toBe(false);
    const verdict = breaker().verdict(window({ complained: 1 }));
    expect(verdict.breached).toBe(true);
    expect(verdict.reason).toBe("complaint_rate");
  });

  /*
   * The floor, and the case it exists for. Two bounces out of five is 40% and means nothing
   * at all; without this the breaker's first act on a new project would be to close it over
   * one undeliverable test address, which is a blameless outage caused by a control.
   */
  it("judges nothing below the volume floor, however bad the ratio looks", () => {
    const tiny = breaker().verdict({ sent: 5, bounced: 2, complained: 1 });
    expect(tiny.breached).toBe(false);
    expect(tiny.reason).toBeNull();
    // The figures are still computed and still recorded, so what was seen is not lost.
    expect(tiny.bounceRatePpm).toBe(400_000);
    expect(tiny.observedSends).toBe(5);
  });

  it("starts judging exactly at the floor", () => {
    expect(breaker().verdict({ sent: 199, bounced: 199, complained: 0 }).breached).toBe(false);
    expect(breaker().verdict({ sent: 200, bounced: 10, complained: 0 }).breached).toBe(true);
  });

  /* Both figures go on the hold whichever one tripped it, because the first question asked
     of a stopped project is "which of the two, and by how much". */
  it("records both rates and the volume whatever tripped", () => {
    const verdict = breaker().verdict(window({ bounced: 80, complained: 3 }));
    expect(verdict.reason).toBe("bounce_rate");
    expect(verdict.bounceRatePpm).toBe(80_000);
    expect(verdict.complaintRatePpm).toBe(3_000);
    expect(verdict.observedSends).toBe(1_000);
  });

  it("takes its thresholds from options, so a deployment can be stricter", () => {
    const strict = breaker({ bounceLimitPpm: 10_000, minimumSends: 10 });
    expect(strict.verdict({ sent: 100, bounced: 2, complained: 0 }).breached).toBe(true);
  });
});
