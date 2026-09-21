import { CcpaDeadline, dsrDeadlineFor, GdprDeadline } from "@idenzy/domain/policies/dsr-deadline";
import { DEFAULT_DSR_DEADLINE_RULE, DsrDeadlineRule } from "@idenzy/protocol/enums/compliance";
import { describe, expect, it } from "vitest";
import { DsrDeadlineConformanceSuite } from "../src/dsr-deadline-conformance.js";

const suite = new DsrDeadlineConformanceSuite();

describe("every data-subject deadline satisfies the family's rules", () => {
  for (const [name, subject] of [
    ["GDPR", new GdprDeadline()],
    ["CCPA", new CcpaDeadline()],
  ] as const) {
    it(`${name} passes the conformance suite`, async () => {
      expect(await suite.run({ subject, name })).toEqual([]);
    });
  }
});

describe("the calendar a deadline is counted on", () => {
  /**
   * The defect this family exists to prevent, stated as a date.
   *
   * GDPR Art. 12(3) is one *month*. A request that arrives on 31 January is due on 28 February.
   * Thirty days of arithmetic makes it 2 March and is late — and the panel already got this right
   * ("the 31st of August is due on the 30th of September"), which is what caught it.
   */
  it("clamps one month to the end of a shorter month rather than overshooting", () => {
    const gdpr = new GdprDeadline();
    expect(gdpr.dueAt(new Date("2026-01-31T12:00:00.000Z")).toISOString()).toBe(
      "2026-02-28T12:00:00.000Z",
    );
    // A leap February, so the clamp has to follow the year and not a table.
    expect(gdpr.dueAt(new Date("2028-01-31T12:00:00.000Z")).toISOString()).toBe(
      "2028-02-29T12:00:00.000Z",
    );
    // 31 August to 30 September, the panel's own example.
    expect(gdpr.dueAt(new Date("2026-08-31T12:00:00.000Z")).toISOString()).toBe(
      "2026-09-30T12:00:00.000Z",
    );
  });

  it("keeps the day of month where the target month is long enough", () => {
    expect(new GdprDeadline().dueAt(new Date("2026-03-15T09:00:00.000Z")).toISOString()).toBe(
      "2026-04-15T09:00:00.000Z",
    );
  });

  it("counts CCPA in days, because that is how it is written", () => {
    expect(new CcpaDeadline().dueAt(new Date("2026-01-31T12:00:00.000Z")).toISOString()).toBe(
      "2026-03-17T12:00:00.000Z",
    );
  });

  it("extends GDPR by two further months from the deadline, not from receipt", () => {
    const gdpr = new GdprDeadline();
    const due = gdpr.dueAt(new Date("2026-01-31T12:00:00.000Z"));
    expect(gdpr.extendedDueAt(due).toISOString()).toBe("2026-04-28T12:00:00.000Z");
  });
});

describe("which rule applies when nobody has said", () => {
  /**
   * The safe direction, and it is not symmetric. Answering a Californian inside a month breaches
   * nothing; answering a European after 45 days breaches Art. 12(3). A processor cannot know where
   * a data subject lives, so the default is the shorter clock.
   */
  it("defaults to the stricter of the two", () => {
    expect(DEFAULT_DSR_DEADLINE_RULE).toBe(DsrDeadlineRule.Gdpr);

    const received = new Date("2026-03-01T12:00:00.000Z");
    const strict = dsrDeadlineFor(DEFAULT_DSR_DEADLINE_RULE).dueAt(received);
    const other = dsrDeadlineFor(DsrDeadlineRule.Ccpa).dueAt(received);
    expect(strict.getTime()).toBeLessThan(other.getTime());
  });

  it("gives each rule its own clock", () => {
    expect(dsrDeadlineFor(DsrDeadlineRule.Gdpr).rule).toBe(DsrDeadlineRule.Gdpr);
    expect(dsrDeadlineFor(DsrDeadlineRule.Ccpa).rule).toBe(DsrDeadlineRule.Ccpa);
  });
});
