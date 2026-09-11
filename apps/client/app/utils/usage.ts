/**
 * What a project used in a billing period and what Idenzy charges for it (PROJECT.md 5.1,
 * `usage_daily`, notes/usage.md).
 *
 * Money is cents from the first multiplication. Each line is rounded to the cent once,
 * halves up, and the total is the sum of the rounded lines, so this screen, Billing's
 * draw-down and the invoice are one figure rather than three figures a cent apart.
 *
 * Rates are imported from the screen that owns them: the email rates and the monthly fee
 * for a sending domain are `~/utils/sending-domains`, and SMS is what the routing table
 * priced each segment at. A usage screen that restated a rate would be a second place for
 * it to be wrong.
 *
 * A line worth nothing still says why: inside the allowance, nothing sent, billed by the
 * customer's own vendor, or not metered at all. Those are four different answers, and a
 * bare "$0.00" gives the same one for each.
 */
import { formatCents } from "./billing";
import { csvCell } from "./filters";
import {
  CUSTOM_DOMAIN_MONTHLY,
  CUSTOM_RATE_PER_THOUSAND,
  SHARED_RATE_PER_THOUSAND,
} from "./sending-domains";
import { type ByoVendor, byoVendorInfo } from "./sms-providers";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/*
 * The price list.
 */

/** Free on every project. The bill starts on the user after this one. */
export const FREE_MAU = 50_000;

/** Per user past the allowance, in dollars. */
export const MAU_PRICE = 0.0025;

/* Integer rates, so a half cent is an exact half and rounds the way the rule says. */
const MAU_TEN_THOUSANDTHS = Math.round(MAU_PRICE * 10_000);
const SHARED_CENTS_PER_THOUSAND = Math.round(SHARED_RATE_PER_THOUSAND * 100);
const CUSTOM_CENTS_PER_THOUSAND = Math.round(CUSTOM_RATE_PER_THOUSAND * 100);
const DOMAIN_CENTS = Math.round(CUSTOM_DOMAIN_MONTHLY * 100);

export function billableMau(mau: number): number {
  return Math.max(0, mau - FREE_MAU);
}

export function mauCents(mau: number): number {
  return Math.round((billableMau(mau) * MAU_TEN_THOUSANDTHS) / 100);
}

/** At the rate the sending-domains screen publishes. Nothing where the customer's own provider carried it. */
export function emailCents(sent: number, ownDomain: boolean, byo: boolean): number {
  if (byo) return 0;
  const rate = ownDomain ? CUSTOM_CENTS_PER_THOUSAND : SHARED_CENTS_PER_THOUSAND;
  return Math.round((sent * rate) / 1000);
}

export function domainsCents(customDomains: number): number {
  return customDomains * DOMAIN_CENTS;
}

/*
 * What a meter means. Written once, here, and read by every screen that counts it.
 */

/**
 * PROJECT.md's first-day-free rule stated as one rule rather than a rule and an exception,
 * which is what read as a contradiction (notes/usage.md P1).
 */
export const MAU_DEFINITION =
  "A user counts once in a calendar month, in UTC, when they authenticate on this project on any day other than the day their account was created. A sign-in, a token refresh and a session exchange all count. An anonymous user counts once upgraded. Counted per project: two projects never share a count or an allowance.";

export const MAU_EXAMPLES: readonly string[] = [
  "Signs up on 3 September and never comes back: not counted, in September or any later month.",
  "Signs up on 3 September and signs in again on the 10th: counted once, in September.",
  "Signed up in July and keeps a session refreshing all through September: counted once, in September.",
];

/** The definition in two sentences, for the place a whole paragraph will not fit. */
export const MAU_SUMMARY =
  "Each user counts once a month per project, for any authentication after the day their account was created. Somebody seen only on the day they signed up is never counted.";

/** The days a projection averages over. */
export const RATE_WINDOW_DAYS = 7;

/** The assumption behind every projected figure, in the words the screen uses for it. */
export const PROJECTION_BASIS = `At the current average rate: each meter's average over the last ${RATE_WINDOW_DAYS} complete days, continued to the end of the month. A straight line, not a forecast of what anybody will do. It overstates active users, which slow as a month goes on because a returning user is counted once.`;

export const ROUNDING_RULE =
  "Each line is rounded to the nearest cent, halves up, and the total is the sum of the rounded lines. Billing draws down that figure and the invoice carries it. Before tax.";

export interface MeterDefinition {
  id: string;
  label: string;
  /** In place of a control on the row: the unit, or why there is none. */
  badge: string;
  description: string;
}

export const METER_DEFINITIONS: readonly MeterDefinition[] = [
  {
    id: "mau",
    label: "Monthly active users",
    badge: "Per project",
    description: `${MAU_DEFINITION} The first ${FREE_MAU.toLocaleString("en")} are free on every project and each one after costs $${MAU_PRICE}.`,
  },
  {
    id: "email",
    label: "Email",
    badge: "Per 1,000",
    description: `Every email this project sends: verification, reset, magic link, one-time code and security notices. ${formatCents(SHARED_CENTS_PER_THOUSAND)} per 1,000 from our domain and ${formatCents(CUSTOM_CENTS_PER_THOUSAND)} from one of yours. Through your own SES or SMTP, Idenzy charges nothing and your provider bills you.`,
  },
  {
    id: "domains",
    label: "Sending domains",
    badge: "Per month",
    description: `${formatCents(DOMAIN_CENTS)} for each domain of yours on the project in a month, verified or not, charged for the whole month it is added in.`,
  },
  {
    id: "sms",
    label: "SMS",
    badge: "Per segment",
    description:
      "Billed per segment at the destination's rate, which the routing table on SMS providers publishes. A message past 160 plain characters, or 70 with a single character outside the GSM set, is more than one segment. Through your own Twilio or Vonage account, Idenzy charges nothing and the vendor bills you.",
  },
  {
    id: "logging",
    label: "Logging",
    badge: "Unavailable",
    description:
      "Not shipped, so nothing is metered and nothing is billed. It will appear in the line items with a published price when it ships, not before.",
  },
  {
    id: "timing",
    label: "Timing and rounding",
    badge: "UTC",
    description: `Metered hourly, so the last hour is not in the figures yet. A month closes at 00:00 UTC on the 1st and its invoice is issued the next day. ${ROUNDING_RULE}`,
  },
];

/*
 * A billing period.
 */

export interface UsagePeriod {
  /** The calendar month in UTC: "2026-09". */
  id: string;
  start: string;
  /** Exclusive: the first instant of the next month. */
  end: string;
  /** Over, so every figure is final and an invoice follows. */
  closed: boolean;
  /** Each UTC day with figures, oldest first. An open period's last day is partial. */
  days: string[];
  /** Monthly active users as the count stood at the end of each day. It only climbs. */
  mau: number[];
  emails: number[];
  smsMessages: number[];
  /** What SMS is billed by: a long or non-GSM message is more than one. */
  smsSegments: number[];
  /** What the segments cost at the destinations' own rates, in cents. */
  smsCostCents: number[];
  /** Sending domains of the customer's own on the project this month, each billed for it. */
  customDomains: number;
  /** Mail left from a domain of theirs, at the lower rate. */
  ownDomain: boolean;
  /** Their own SES or SMTP, which Idenzy does not bill for. */
  byoEmail: boolean;
  /** Whose account carried SMS, or null for our routing. */
  smsVendor: ByoVendor | null;
}

export interface UsageTotals {
  mau: number;
  emails: number;
  smsMessages: number;
  smsSegments: number;
  smsCostCents: number;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** A level is whatever it was on the last day, never the sum of the days. */
export function latest(values: readonly number[]): number {
  return values.at(-1) ?? 0;
}

export function totalsOf(period: UsagePeriod): UsageTotals {
  return {
    mau: latest(period.mau),
    emails: sum(period.emails),
    smsMessages: sum(period.smsMessages),
    smsSegments: sum(period.smsSegments),
    smsCostCents: sum(period.smsCostCents),
  };
}

/** How much of the period has passed, 0 to 1. */
export function periodProgress(period: UsagePeriod, now: Date): number {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

/**
 * The same instant one calendar month earlier, in UTC, clamped to the shorter month: the
 * 31st of March is compared with the 28th of February rather than with the 3rd of March.
 */
export function monthBefore(at: Date): Date {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month - 1,
      Math.min(at.getUTCDate(), lastDay),
      at.getUTCHours(),
      at.getUTCMinutes(),
      at.getUTCSeconds(),
      at.getUTCMilliseconds(),
    ),
  );
}

/**
 * The period as it stood at an instant, for "the same point last month". The day the
 * instant falls in is taken pro rata, so eleven and a half days are compared with eleven
 * and a half days rather than twelve.
 */
export function periodAt(period: UsagePeriod, at: Date): UsagePeriod {
  const cut = at.getTime();
  const kept = period.days.filter((day) => Date.parse(day) < cut).length;
  const last = kept - 1;
  const lastStart = last < 0 ? cut : Date.parse(period.days[last] ?? period.start);
  const share = Math.min(1, Math.max(0, (cut - lastStart) / DAY));

  const counter = (values: readonly number[]) =>
    values
      .slice(0, kept)
      .map((value, index) => (index === last ? Math.round(value * share) : value));
  const mau = period.mau.slice(0, kept).map((value, index) => {
    if (index !== last) return value;
    const before = period.mau[index - 1] ?? 0;
    return Math.round(before + (value - before) * share);
  });

  return {
    ...period,
    days: period.days.slice(0, kept),
    mau,
    emails: counter(period.emails),
    smsMessages: counter(period.smsMessages),
    smsSegments: counter(period.smsSegments),
    smsCostCents: counter(period.smsCostCents),
  };
}

/*
 * The bill.
 */

export type LineId = "mau" | "email" | "domains" | "sms" | "logging" | "security";

/**
 * Why a line comes to what it does. `allowance`, `no_usage`, `vendor` and `unmetered` all
 * charge nothing and mean four different things (notes/usage.md, acceptance checks).
 */
export type LineState = "charged" | "allowance" | "no_usage" | "vendor" | "unmetered" | "included";

export interface BillLine {
  id: LineId;
  label: string;
  /** In the billed unit. Null where there is nothing to count. */
  quantity: number | null;
  unit: string;
  /** Under the quantity: "12,140 past the free 50,000", "620 messages". */
  detail: string;
  rate: string;
  /** Charged by Idenzy, in cents. Null where nothing is metered. */
  cents: number | null;
  /** Who invoices the line: "Idenzy", "Your Twilio account". */
  owner: string;
  state: LineState;
  /** Beside the charge, where a bare figure would mislead. */
  note: string;
}

export interface Bill {
  lines: BillLine[];
  totalCents: number;
}

function count(value: number): string {
  return value.toLocaleString("en");
}

function plural(value: number, one: string, many: string): string {
  return value === 1 ? one : many;
}

function mauLine(totals: UsageTotals): BillLine {
  const billable = billableMau(totals.mau);
  return {
    id: "mau",
    label: "Monthly active users",
    quantity: totals.mau,
    unit: plural(totals.mau, "user", "users"),
    detail:
      billable === 0
        ? `Within the free ${count(FREE_MAU)}`
        : `${count(billable)} past the free ${count(FREE_MAU)}`,
    rate: `$${MAU_PRICE} per user past ${count(FREE_MAU)}`,
    cents: mauCents(totals.mau),
    owner: "Idenzy",
    state: billable === 0 ? "allowance" : "charged",
    note: billable === 0 ? "Inside the allowance" : "",
  };
}

function emailLine(period: UsagePeriod, totals: UsageTotals): BillLine {
  const shared = {
    id: "email" as const,
    label: "Email",
    quantity: totals.emails,
    unit: plural(totals.emails, "email", "emails"),
  };
  if (period.byoEmail) {
    return {
      ...shared,
      detail: "Through your own provider",
      rate: "No Idenzy carriage fee",
      cents: 0,
      owner: "Your SES or SMTP provider",
      state: "vendor",
      note: "Charged by Idenzy. Your provider bills you separately.",
    };
  }
  const perThousand = period.ownDomain ? CUSTOM_CENTS_PER_THOUSAND : SHARED_CENTS_PER_THOUSAND;
  return {
    ...shared,
    detail: period.ownDomain ? "From a domain of yours" : "From our shared domain",
    rate: `${formatCents(perThousand)} per 1,000`,
    cents: emailCents(totals.emails, period.ownDomain, false),
    owner: "Idenzy",
    state: totals.emails === 0 ? "no_usage" : "charged",
    note: totals.emails === 0 ? "Nothing sent" : "",
  };
}

/** Only where the project has a domain of its own: nothing to count is not a line. */
function domainsLine(period: UsagePeriod): BillLine[] {
  if (period.customDomains === 0) return [];
  return [
    {
      id: "domains",
      label: "Sending domains",
      quantity: period.customDomains,
      unit: plural(period.customDomains, "domain", "domains"),
      detail: "Billed for the month, verified or not",
      rate: `${formatCents(DOMAIN_CENTS)} per domain a month`,
      cents: domainsCents(period.customDomains),
      owner: "Idenzy",
      state: "charged",
      note: "",
    },
  ];
}

function smsLine(period: UsagePeriod, totals: UsageTotals): BillLine {
  const vendor = period.smsVendor === null ? null : byoVendorInfo(period.smsVendor);
  const shared = {
    id: "sms" as const,
    label: "SMS",
    quantity: totals.smsSegments,
    unit: plural(totals.smsSegments, "segment", "segments"),
    detail: `${count(totals.smsMessages)} ${plural(totals.smsMessages, "message", "messages")}`,
  };
  if (vendor) {
    return {
      ...shared,
      rate: "No Idenzy carriage fee",
      cents: 0,
      owner: `Your ${vendor.label} account`,
      state: "vendor",
      note: `Charged by Idenzy. ${vendor.label} bills you separately.`,
    };
  }
  return {
    ...shared,
    rate: "The destination's rate per segment",
    cents: totals.smsCostCents,
    owner: "Idenzy",
    state: totals.smsSegments === 0 ? "no_usage" : "charged",
    note: totals.smsSegments === 0 ? "Nothing sent" : "",
  };
}

/** Not shipped: no quantity, no charge and no price, rather than a zero that looks measured. */
const LOGGING_LINE: BillLine = {
  id: "logging",
  label: "Logging",
  quantity: null,
  unit: "",
  detail: "Not shipped",
  rate: "No published price",
  cents: null,
  owner: "Not billed",
  state: "unmetered",
  note: "Not metered",
};

/** On every bill so what costs nothing at any volume is seen to cost nothing. */
const SECURITY_LINE: BillLine = {
  id: "security",
  label: "Security features",
  quantity: null,
  unit: "",
  detail: "Passkeys, MFA, custom auth domains, the audit trail",
  rate: "No charge at any volume",
  cents: 0,
  owner: "Idenzy",
  state: "included",
  note: "Included",
};

function linesFrom(period: UsagePeriod, totals: UsageTotals): BillLine[] {
  return [
    mauLine(totals),
    emailLine(period, totals),
    ...domainsLine(period),
    smsLine(period, totals),
    { ...LOGGING_LINE },
    { ...SECURITY_LINE },
  ];
}

function billOf(lines: BillLine[]): Bill {
  return { lines, totalCents: lines.reduce((total, line) => total + (line.cents ?? 0), 0) };
}

/** Every line, including the ones that come to nothing, and the sum of their rounded cents. */
export function billFor(period: UsagePeriod): Bill {
  return billOf(linesFrom(period, totalsOf(period)));
}

/** The quantity as a cell writes it: "62,140 users", or why there is no count. */
export function quantityWords(line: BillLine): string {
  if (line.quantity === null) return line.state === "included" ? "Included" : "Not metered";
  return `${count(line.quantity)} ${line.unit}`;
}

/*
 * Where the month lands.
 */

/** The average of the last complete days, or of the part of the day there is. */
function dailyRate(values: readonly number[], complete: number, partialShare: number): number {
  if (complete === 0) return (values[0] ?? 0) / Math.max(partialShare, 1 / 24);
  const recent = values.slice(Math.max(0, complete - RATE_WINDOW_DAYS), complete);
  return sum(recent) / recent.length;
}

/**
 * Each meter at month-end if the rest of the month runs at the last week's average
 * (`PROJECTION_BASIS`). Per meter rather than the total divided by the month's progress,
 * because active users are free up to the allowance and a domain costs the same on the
 * 1st as on the 30th: straight-lining the dollars would project neither correctly.
 */
export function projectTotals(period: UsagePeriod, asOf: Date): UsageTotals {
  const so = totalsOf(period);
  if (period.closed || period.days.length === 0) return so;

  const lastStart = Date.parse(period.days.at(-1) ?? period.start);
  const partialShare = Math.min(1, Math.max(0, (asOf.getTime() - lastStart) / DAY));
  const complete = partialShare < 1 ? period.days.length - 1 : period.days.length;
  const remaining = Math.max(0, (Date.parse(period.end) - asOf.getTime()) / DAY);

  const additions = period.mau.map((value, index) => value - (period.mau[index - 1] ?? 0));
  const ahead = (values: readonly number[]) =>
    dailyRate(values, complete, partialShare) * remaining;

  return {
    mau: Math.round(so.mau + ahead(additions)),
    emails: Math.round(so.emails + ahead(period.emails)),
    smsMessages: Math.round(so.smsMessages + ahead(period.smsMessages)),
    smsSegments: Math.round(so.smsSegments + ahead(period.smsSegments)),
    smsCostCents: Math.round(so.smsCostCents + ahead(period.smsCostCents)),
  };
}

/** The bill at month-end on the projected totals. A closed period's is its own bill. */
export function projectBill(period: UsagePeriod, asOf: Date): Bill {
  return billOf(linesFrom(period, projectTotals(period, asOf)));
}

/*
 * The activity chart.
 */

export type UsageRange = "1d" | "7d" | "30d";

export interface UsageWindow {
  granularity: "hour" | "day";
  /** Bucket starts, oldest first, in epoch milliseconds. */
  buckets: number[];
}

const RANGE_BUCKETS: Record<UsageRange, number> = { "1d": 24, "7d": 7, "30d": 30 };

/** The buckets that end at `anchor`, which is exclusive: the instant the figures run to. */
export function usageWindow(range: UsageRange, anchor: Date): UsageWindow {
  const granularity = range === "1d" ? "hour" : "day";
  const step = granularity === "hour" ? HOUR : DAY;
  const last = Math.floor((anchor.getTime() - 1) / step) * step;
  const length = RANGE_BUCKETS[range];
  return {
    granularity,
    buckets: Array.from({ length }, (_, index) => last - (length - 1 - index) * step),
  };
}

/**
 * The window and what it is compared with: the same buckets one calendar month earlier.
 * Not the window immediately before, because active users are a level that starts again
 * on the 1st, and the seven days before the 7th of a month straddle that reset.
 */
export function usageWindows(range: UsageRange, anchor: Date) {
  return { current: usageWindow(range, anchor), previous: usageWindow(range, monthBefore(anchor)) };
}

const TICK_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const TICK_HOUR = new Intl.DateTimeFormat("en", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function bucketTick(bucket: number, granularity: UsageWindow["granularity"]): string {
  return (granularity === "hour" ? TICK_HOUR : TICK_DAY).format(bucket);
}

/** "Sep 11", or "Sep 11, 14:00" for an hour. */
export function bucketTitle(bucket: number, granularity: UsageWindow["granularity"]): string {
  const day = TICK_DAY.format(bucket);
  return granularity === "hour" ? `${day}, ${TICK_HOUR.format(bucket)}` : day;
}

/** "Sep 5 to 11", "Aug 13 to Sep 11", "24 hours to Sep 11, 15:00". */
export function windowLabel(window: UsageWindow): string {
  const first = window.buckets[0] ?? 0;
  const last = window.buckets.at(-1) ?? first;
  if (window.granularity === "hour") return `24 hours to ${bucketTitle(last + HOUR, "hour")}`;
  const from = TICK_DAY.format(first);
  const to = TICK_DAY.format(last);
  const sameMonth = new Date(first).getUTCMonth() === new Date(last).getUTCMonth();
  return `${from} to ${sameMonth ? new Date(last).getUTCDate() : to}`;
}

export type ChartMeterId = "mau" | "emails" | "sms";

export interface ChartMeter {
  id: ChartMeterId;
  label: string;
  description: string;
}

/** What the chart can draw. Logging is not among them: a meter that does not exist has no line. */
export const CHART_METERS: readonly ChartMeter[] = [
  {
    id: "mau",
    label: "Monthly active users",
    description:
      "The month's count as it stood at each point. It starts again on the 1st, so a window across a month drops there.",
  },
  {
    id: "emails",
    label: "Emails sent",
    description: "Every email this project sent, whoever carried it.",
  },
  {
    id: "sms",
    label: "SMS segments",
    description: "Segments sent, which is the unit an SMS is billed by.",
  },
];

/*
 * Naming a period.
 */

const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_ONLY = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });
const SPAN_DAY = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "September 2026". */
export function periodLabel(period: UsagePeriod): string {
  return MONTH.format(Date.parse(period.start));
}

/** "September". */
export function periodMonth(period: UsagePeriod): string {
  return MONTH_ONLY.format(Date.parse(period.start));
}

/** "Sep 1 to Sep 30, 2026": the last day, since `end` is the first instant after it. */
export function periodSpan(period: UsagePeriod): string {
  const first = TICK_DAY.format(Date.parse(period.start));
  return `${first} to ${SPAN_DAY.format(Date.parse(period.end) - DAY)}`;
}

/** "Sep 30": the last day of the period, which a projection runs to. */
export function periodLastDay(period: UsagePeriod): string {
  return TICK_DAY.format(Date.parse(period.end) - DAY);
}

/*
 * Taking it away.
 */

export interface UsageExport {
  period: UsagePeriod;
  projectId: string;
  projectName: string;
  actual: Bill;
  /** The month-end estimate, for an open period only. */
  projected: Bill | null;
  /** The instant the figures run to. */
  updatedAt: string | null;
}

function dollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/**
 * The period as CSV, carrying what the notes ask an export to carry: the period, the
 * scope, the currency, each line's unit and owner, and whether a figure is actual, final
 * or estimated. An open period's estimate is its own rows rather than a column, so a sum
 * down the charge column of either set is that set's total.
 */
export function usageCsv(input: UsageExport): string {
  const header = [
    "period",
    "period_start",
    "period_end",
    "project_id",
    "project",
    "currency",
    "basis",
    "line_item",
    "quantity",
    "unit",
    "unit_rate",
    "idenzy_charge",
    "billing_owner",
    "data_updated_at",
  ];

  const { period } = input;
  const rows = (bill: Bill, basis: string) => [
    ...bill.lines.map((line) => [
      period.id,
      period.start,
      period.end,
      input.projectId,
      input.projectName,
      "USD",
      basis,
      line.label,
      line.quantity ?? "",
      line.quantity === null ? quantityWords(line) : line.unit,
      line.rate,
      dollars(line.cents),
      line.owner,
      input.updatedAt ?? "",
    ]),
    [
      period.id,
      period.start,
      period.end,
      input.projectId,
      input.projectName,
      "USD",
      basis,
      "Total",
      "",
      "",
      "",
      dollars(bill.totalCents),
      "Idenzy",
      input.updatedAt ?? "",
    ],
  ];

  const body = [
    ...rows(input.actual, period.closed ? "final" : "actual"),
    ...(input.projected && !period.closed ? rows(input.projected, "estimated") : []),
  ];

  return [header.join(","), ...body.map((row) => row.map(csvCell).join(","))].join("\n");
}
