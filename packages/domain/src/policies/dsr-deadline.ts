import { DsrDeadlineRule } from "@idenzy/protocol/enums/compliance";

/**
 * A calendar month later, in UTC, clamped to the end of a shorter month.
 *
 * Not 30 days, and the difference is a missed statutory deadline rather than a rounding error.
 * GDPR Art. 12(3) says "one month"; a request received on 31 January is due on 28 February, and
 * day arithmetic makes it 2 March — two days late. The other direction bites too: 31 August plus
 * a month is 30 September, which day arithmetic gets right by accident and only for 30-day months.
 *
 * UTC throughout, because a statutory date decided by which country a server runs in is not a
 * statutory date.
 */
function addCalendarMonthsUtc(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();

  // To the first before shifting: setting the month on the 31st rolls into the next one.
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDayOfTarget = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDayOfTarget));
  return result;
}

function addDaysUtc(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * The statutory clock one data-subject request is answered on (PROJECT.md 4.13.6).
 *
 * **Per request, not per cell.** A cell's jurisdiction says where bytes sit; this says which law
 * governs one person's rights, and the two come apart whenever a customer in one place has users
 * in another. Idenzy is a processor, so the rule is the controller's determination and travels
 * with the request — which is the shape `apps/client/app/utils/data-requests.ts` had first, and
 * it is the specification here.
 *
 * The figures are deliberately duplicated between this file and the panel's `RULE_INFO` rather
 * than shared, because the panel takes no dependency on `@idenzy/domain`. What stops them drifting
 * is `dsr-deadline-conformance`, which asserts them against each other.
 */
export abstract class DsrDeadline {
  abstract readonly rule: DsrDeadlineRule;

  /** How the rule words its own window, for a sentence a person reads. */
  abstract readonly period: string;

  /** Where it says so, so a refusal can cite it. */
  abstract readonly citation: string;

  /** When a request received at `receivedAt` must be answered by. */
  abstract dueAt(receivedAt: Date): Date;

  /**
   * The latest an extension can move a deadline to, counted from the deadline it replaces.
   *
   * From the due date rather than from receipt, which is how both rules are written: GDPR's two
   * further months and CCPA's 45 more days are added to the first period, not substituted for it.
   */
  abstract extendedDueAt(dueAt: Date): Date;
}

/** GDPR Art. 12(3): one calendar month, extendable once by two further months. */
export class GdprDeadline extends DsrDeadline {
  override readonly rule = DsrDeadlineRule.Gdpr;
  override readonly period = "one month";
  override readonly citation = "Art. 12(3)";

  override dueAt(receivedAt: Date): Date {
    return addCalendarMonthsUtc(receivedAt, 1);
  }

  override extendedDueAt(dueAt: Date): Date {
    return addCalendarMonthsUtc(dueAt, 2);
  }
}

/** CCPA, Cal. Civ. Code 1798.130: 45 days, extendable once by 45 more. */
export class CcpaDeadline extends DsrDeadline {
  override readonly rule = DsrDeadlineRule.Ccpa;
  override readonly period = "45 days";
  override readonly citation = "Cal. Civ. Code 1798.130";

  override dueAt(receivedAt: Date): Date {
    return addDaysUtc(receivedAt, 45);
  }

  override extendedDueAt(dueAt: Date): Date {
    return addDaysUtc(dueAt, 45);
  }
}

/**
 * The clock for a rule, exhaustively.
 *
 * No default here on purpose: a caller that does not know which rule applies should reach for
 * `DEFAULT_DSR_DEADLINE_RULE`, which is a decision with a reason written beside it, rather than
 * get one from a `switch` falling through.
 */
export function dsrDeadlineFor(rule: DsrDeadlineRule): DsrDeadline {
  switch (rule) {
    case DsrDeadlineRule.Gdpr:
      return new GdprDeadline();
    case DsrDeadlineRule.Ccpa:
      return new CcpaDeadline();
  }
}
