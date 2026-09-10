/**
 * What a project has used this month and what it costs (PROJECT.md 5.1, `usage_daily`).
 *
 * Every price here is imported from the screen that owns it rather than restated. The
 * per-thousand email rates and the five dollars a month for a custom sending domain are
 * `~/utils/sending-domains`; SMS is charged at what the sends actually cost, which the
 * routing table decides. A bill that quoted a rate a settings screen contradicts is worse
 * than a bill with no rates on it at all, and the two drift the day somebody changes one.
 *
 * The two numbers that matter most on the screen are not the total. They are how far into
 * the free tier a project is, because fifty thousand monthly active users is where a bill
 * starts existing at all, and where the month lands at this rate, because a total halfway
 * through a month answers a question nobody asked.
 *
 * Logging is on the list and is not billed yet. It is metered per gigabyte ingested, the
 * rate below is a proposal rather than a published price, and the row says so. A meter a
 * customer cannot see until the invoice arrives is how a usage screen loses its job.
 */

import { type FigureFormat, formatFigure } from "./format";
import {
  CUSTOM_DOMAIN_MONTHLY,
  CUSTOM_RATE_PER_THOUSAND,
  SHARED_RATE_PER_THOUSAND,
} from "./sending-domains";

/*
 * What is metered.
 */

export type MeterId = "mau" | "email" | "sms" | "logging";

export interface Meter {
  id: MeterId;
  label: string;
  /** What the chart's figure is, at the top of the card. */
  headline: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  format: FigureFormat;
  /** Whether a day's figure adds up over the month or is read off the last day. */
  cumulative: boolean;
  note: string;
  /** Not shipped, so the meter reads zero and its rate is a proposal. */
  provisional?: boolean;
}

export const METERS: readonly Meter[] = [
  {
    id: "mau",
    label: "Monthly active users",
    headline: "Active users",
    icon: "material-symbols:group-outline",
    format: "number",
    cumulative: false,
    note: "A user who authenticated at least once this calendar month. A user created and never seen again after their first day is not counted, and an anonymous one counts only once it is upgraded.",
  },
  {
    id: "email",
    label: "Email",
    headline: "Emails sent",
    icon: "material-symbols:mail-outline",
    format: "number",
    cumulative: true,
    note: "Verification, reset, magic link, one-time code and the security notices. Bringing your own SES or SMTP makes this free.",
  },
  {
    id: "sms",
    label: "SMS",
    headline: "Messages sent",
    icon: "material-symbols:sms-outline",
    format: "number",
    cumulative: true,
    note: "Billed per segment at the destination's own rate, which the routing table publishes per country. Bringing your own Twilio or Vonage makes this free.",
  },
  {
    id: "logging",
    label: "Logging",
    headline: "Ingested",
    icon: "material-symbols:database-outline",
    format: "bytes",
    cumulative: true,
    provisional: true,
    note: "Structured logs and delivery events kept for you to search. Metered by what is ingested rather than by what is stored, so a query costs nothing to run.",
  },
];

export function meter(id: MeterId): Meter {
  return METERS.find((entry) => entry.id === id) ?? (METERS[0] as Meter);
}

/*
 * The price list (PROJECT.md 5.1).
 */

/** Free on every project, forever. The bill starts on the user after this one. */
export const FREE_MAU = 50_000;

export const MAU_PRICE = 0.0025;

/**
 * A gigabyte of logs ingested. Provisional: logging is not shipped and this rate is a
 * proposal, kept here so the screen can price a month rather than leave a blank where a
 * customer's largest new line will be.
 */
export const LOGGING_PRICE_PER_GB = 0.3;

export const GIGABYTE = 1024 ** 3;

/** Only the users past the free tier are charged, which is the whole shape of the plan. */
export function billableMau(mau: number): number {
  return Math.max(0, mau - FREE_MAU);
}

export function mauCost(mau: number): number {
  return billableMau(mau) * MAU_PRICE;
}

/** How much of the free tier is gone, 0 to 1, for the meter beside it. */
export function freeTierShare(mau: number): number {
  return Math.min(1, Math.max(0, mau / FREE_MAU));
}

/** What a month of mail costs, at the rate the sending-domains screen publishes. */
export function emailCost(sent: number, ownDomain: boolean, byo: boolean): number {
  if (byo) return 0;
  const rate = ownDomain ? CUSTOM_RATE_PER_THOUSAND : SHARED_RATE_PER_THOUSAND;
  return (sent / 1000) * rate;
}

export function domainsCost(customDomains: number): number {
  return customDomains * CUSTOM_DOMAIN_MONTHLY;
}

export function loggingCost(bytes: number): number {
  return (bytes / GIGABYTE) * LOGGING_PRICE_PER_GB;
}

/*
 * A month.
 */

export interface UsagePeriod {
  /** The calendar month being billed, as ISO instants. */
  start: string;
  end: string;
  /** One entry per day so far, oldest first. */
  days: string[];
  /** Active users as at each day, which is a level and never a sum. */
  mau: number[];
  emails: number[];
  sms: number[];
  /** What those sends actually cost, in dollars, at the destinations' own rates. */
  smsCost: number[];
  logBytes: number[];
  /** Verified sending domains of the customer's own, each billed monthly. */
  customDomains: number;
  /** Their own SES or SMTP, which makes email free. */
  byoEmail: boolean;
  /** Their own Twilio or Vonage, which makes SMS free. */
  byoSms: boolean;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** A level metric is whatever it was on the last day, never the sum of the days. */
export function latest(values: readonly number[]): number {
  return values.at(-1) ?? 0;
}

export function totalFor(period: UsagePeriod, id: MeterId): number {
  if (id === "mau") return latest(period.mau);
  if (id === "email") return sum(period.emails);
  if (id === "sms") return sum(period.sms);
  return sum(period.logBytes);
}

export function seriesFor(period: UsagePeriod, id: MeterId): number[] {
  if (id === "mau") return period.mau;
  if (id === "email") return period.emails;
  if (id === "sms") return period.sms;
  return period.logBytes;
}

/*
 * The bill.
 */

export interface CostLine {
  id: string;
  label: string;
  /** The quantity as the row writes it: "62,140 users", "18,402 emails". */
  quantity: string;
  /** The rate as the row writes it, or why there is none. */
  rate: string;
  amount: number;
  /** Nothing to pay, and the row says why rather than showing a zero. */
  free?: boolean;
  /** The rate is a proposal, not a published price. */
  provisional?: boolean;
}

export interface Bill {
  lines: CostLine[];
  total: number;
}

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function count(value: number): string {
  return value.toLocaleString("en");
}

/**
 * Every line, including the ones that come to nothing.
 *
 * A line worth zero is still a line: "50,000 of 50,000 users, free" is the answer to what
 * a customer is actually asking, and a bill that omitted it would read as a bill that had
 * not counted them. The same goes for a channel somebody brought their own vendor for.
 */
export function billFor(period: UsagePeriod): Bill {
  const mau = latest(period.mau);
  const emails = sum(period.emails);
  const messages = sum(period.sms);
  const bytes = sum(period.logBytes);
  const billable = billableMau(mau);

  const lines: CostLine[] = [
    {
      id: "mau",
      label: "Monthly active users",
      quantity:
        billable === 0
          ? `${count(mau)} of ${count(FREE_MAU)} free`
          : `${count(billable)} past the free ${count(FREE_MAU)}`,
      rate: billable === 0 ? "Free on every project" : `$${MAU_PRICE.toFixed(4)} each`,
      amount: mauCost(mau),
      ...(billable === 0 ? { free: true } : {}),
    },
    {
      id: "email",
      label: "Email",
      quantity: `${count(emails)} sent`,
      rate: period.byoEmail
        ? "Your own SES or SMTP"
        : `${money(period.customDomains > 0 ? CUSTOM_RATE_PER_THOUSAND : SHARED_RATE_PER_THOUSAND)} per 1,000`,
      amount: emailCost(emails, period.customDomains > 0, period.byoEmail),
      ...(period.byoEmail ? { free: true } : {}),
    },
    {
      id: "sms",
      label: "SMS",
      quantity: `${count(messages)} sent`,
      rate: period.byoSms ? "Your own account" : "The destination's own rate",
      amount: period.byoSms ? 0 : sum(period.smsCost),
      ...(period.byoSms ? { free: true } : {}),
    },
    {
      id: "logging",
      label: "Logging",
      quantity: formatBytes(bytes),
      rate: `${money(LOGGING_PRICE_PER_GB)} per GB, proposed`,
      amount: 0,
      free: true,
      provisional: true,
    },
  ];

  if (period.customDomains > 0) {
    lines.splice(2, 0, {
      id: "domains",
      label: "Sending domains",
      quantity: `${period.customDomains} of your own`,
      rate: `${money(CUSTOM_DOMAIN_MONTHLY)} a month each`,
      amount: domainsCost(period.customDomains),
    });
  }

  return { lines, total: lines.reduce((running, line) => running + line.amount, 0) };
}

/** Bytes in the panel's voice: "1.4 GB", never "1503238553". */
export function formatBytes(bytes: number): string {
  const parts = formatFigure(bytes, { format: "bytes", decimals: 1 });
  return `${parts.digits}${parts.magnitude} ${parts.unit}`.trim();
}

/*
 * Where the month lands.
 */

/** How much of the billing period has passed, 0 to 1. */
export function periodProgress(period: UsagePeriod, now: Date): number {
  const start = new Date(period.start).getTime();
  const end = new Date(period.end).getTime();
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

/**
 * Where a running total lands if the rest of the month looks like the part that has
 * happened. Straight-line, which is the only projection worth showing: anything cleverer
 * invites a reader to trust it, and a bill is not a forecast.
 *
 * A level metric such as active users is not projected at all. Its value is not a running
 * total, so multiplying it by the month's remainder would say nothing.
 */
export function projectedTotal(soFar: number, progress: number): number {
  if (progress <= 0) return soFar;
  return soFar / progress;
}
