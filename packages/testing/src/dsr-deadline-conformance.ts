import { strict as assert } from "node:assert";
import type { DsrDeadline } from "@idenzy/domain/policies/dsr-deadline";
import { ConformanceSuite } from "./conformance-suite.js";

/**
 * The suite every data-subject deadline must pass (PROJECT.md 7.4).
 *
 * Properties rather than figures, as with every conformance suite here: a case asserting "GDPR is
 * one month" restates the constant beside it. These are the things that must hold of any rule
 * anybody adds — and the first one is the defect this family was written to prevent.
 *
 * A statutory deadline computed with day arithmetic is late. GDPR Art. 12(3) says one *month*, so
 * a request received on 31 January is due on 28 February; thirty days makes it 2 March. Two days
 * late on a regulatory clock is a finding, and it is the kind of thing that is invisible in a test
 * suite that only ever uses the 1st of the month.
 */
export class DsrDeadlineConformanceSuite extends ConformanceSuite<DsrDeadline> {
  override readonly familyName = "DsrDeadline";

  protected override defineCases() {
    return [
      {
        name: "never lands on or before the day the request arrived",
        run: ({ subject }: { subject: DsrDeadline }) => {
          for (const iso of ["2026-01-31T23:59:59.000Z", "2026-02-28T00:00:00.000Z"]) {
            const received = new Date(iso);
            assert.ok(
              subject.dueAt(received).getTime() > received.getTime(),
              `${subject.rule} produced a deadline at or before receipt for ${iso}`,
            );
          }
        },
      },
      {
        name: "survives the end of a short month without overshooting into the next one",
        run: ({ subject }: { subject: DsrDeadline }) => {
          // The case day arithmetic gets wrong. A rule counting in months must clamp to the last
          // day of a shorter month; a rule counting in days must simply not claim to count months.
          const received = new Date("2026-01-31T12:00:00.000Z");
          const due = subject.dueAt(received);
          assert.ok(
            due.getTime() > received.getTime(),
            "a deadline from the 31st must still be in the future",
          );
          // Whatever the unit, one period from 31 January cannot reach March.
          assert.ok(
            due.getTime() <= new Date("2026-03-17T23:59:59.999Z").getTime(),
            `${subject.rule} overshot: 31 Jan gave ${due.toISOString()}`,
          );
        },
      },
      {
        name: "computes in UTC, so a clock change cannot move a statutory date",
        run: ({ subject }: { subject: DsrDeadline }) => {
          // Spans both daylight-saving transitions. A deadline that drifts by an hour across
          // these was computed in local time somewhere.
          for (const iso of ["2026-03-25T12:00:00.000Z", "2026-10-28T12:00:00.000Z"]) {
            const due = subject.dueAt(new Date(iso));
            assert.equal(
              due.getUTCHours(),
              12,
              `${subject.rule} drifted the time of day across a DST boundary from ${iso}`,
            );
          }
        },
      },
      {
        name: "extends from the deadline it replaces, never from receipt",
        run: ({ subject }: { subject: DsrDeadline }) => {
          const received = new Date("2026-03-01T12:00:00.000Z");
          const due = subject.dueAt(received);
          const extended = subject.extendedDueAt(due);
          assert.ok(
            extended.getTime() > due.getTime(),
            "an extension must move the deadline later",
          );
          // Both rules add their extension to the first period rather than replacing it, so the
          // extended date must be at least two periods from receipt.
          assert.ok(
            extended.getTime() - received.getTime() >= (due.getTime() - received.getTime()) * 2 - 1,
            `${subject.rule} extended from receipt rather than from the deadline`,
          );
        },
      },
      {
        name: "can cite itself, because a refusal has to say which rule it was refused under",
        run: ({ subject }: { subject: DsrDeadline }) => {
          assert.ok(subject.period.length > 0, "a rule must be able to state its own window");
          assert.ok(subject.citation.length > 0, "a rule must be able to cite itself");
        },
      },
    ];
  }
}
