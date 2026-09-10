/**
 * What the account has to spend, what it is spending it on, and how it is paid for
 * (PROJECT.md 5.1, `orgs.billing_customer_id`).
 *
 * Money is in cents everywhere, the way the billing API hands it over, and the panel
 * never does arithmetic on a float. A dollar figure is produced at the last moment, for
 * display, by one function.
 *
 * The rule this page exists to state is what a balance at zero does, and the answer is
 * that it never stops a sign-in. This is an authentication product: refusing to
 * authenticate somebody because an invoice is unpaid takes a customer's own product down
 * and takes their users with it, and no amount owed is worth that. What does stop is the
 * traffic that costs us money the moment it leaves, which is the same reasoning the SMS
 * spend cap is built on, pointed the other way.
 *
 * The card is never ours to see. The field that takes a number belongs to the payment
 * provider; what this panel holds is a token, a brand and four digits, which is all that
 * can be shown and all that is worth storing.
 */

/*
 * Money.
 */

/** The one place a figure becomes a string. Cents in, because the API deals in cents. */
export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/*
 * The balance.
 */

export interface Balance {
  /** What is left, in cents. Negative is owed. */
  cents: number;
  currency: string;
  /** What the current month has drawn down so far, in cents. */
  spentThisMonthCents: number;
  /** What the month is on course to draw down in total, in cents. */
  projectedMonthCents: number;
}

/**
 * How long the balance lasts at the month's rate, in days.
 *
 * The figure a prepaid account is actually read for. Infinity where nothing is being
 * spent, because a project inside the free tier has no runway to run out of and a number
 * there would be an invented worry.
 */
export function runwayDays(balance: Balance): number {
  if (balance.projectedMonthCents <= 0) return Number.POSITIVE_INFINITY;
  const perDay = balance.projectedMonthCents / 30;
  return Math.max(0, balance.cents / perDay);
}

/** Under this and the balance reads as something to act on rather than something to note. */
export const LOW_RUNWAY_DAYS = 14;

/**
 * Past this the runway stops being a number and becomes a sentence.
 *
 * A balance that lasts three thousand days is arithmetically true and useless: nobody
 * plans against it, and four digits of days reads as a fault in the sum rather than as
 * good news. Over a year is the only thing worth saying.
 */
export const RUNWAY_HORIZON_DAYS = 365;

export function runwayTone(balance: Balance): "success" | "warning" | "error" {
  if (balance.cents <= 0) return "error";
  const days = runwayDays(balance);
  if (!Number.isFinite(days)) return "success";
  return days <= LOW_RUNWAY_DAYS ? "warning" : "success";
}

/** How the runway reads: "about 41 days", "under a day", "nothing is being spent". */
export function runwayWords(balance: Balance): string {
  if (balance.cents <= 0) return "The balance is spent";
  const days = runwayDays(balance);
  if (!Number.isFinite(days)) return "Nothing is being spent";
  if (days < 1) return "Under a day left";
  if (days > RUNWAY_HORIZON_DAYS) return "More than a year left";
  return `About ${Math.floor(days)} ${Math.floor(days) === 1 ? "day" : "days"} left`;
}

/*
 * What a zero balance does, and what it does not.
 */

export interface ZeroRule {
  what: string;
  why: string;
}

/** Never, whatever is owed. The first list, because it is the one nobody believes. */
export const ZERO_KEEPS_WORKING: readonly ZeroRule[] = [
  {
    what: "Every sign-in, refresh and session",
    why: "Refusing to authenticate over an unpaid invoice takes your product down and your users with it. No amount owed is worth that, so it is not a lever we have.",
  },
  {
    what: "The dashboard, the API and your keys",
    why: "You can still see what is happening and still turn things off. An account somebody cannot reach is one they cannot fix.",
  },
  {
    what: "Email on the shared domain",
    why: "A verification mail nobody can receive is a sign-up nobody can finish, which is the same outage by another route.",
  },
];

/** What does stop, and it is the traffic that costs money the moment it leaves. */
export const ZERO_STOPS: readonly ZeroRule[] = [
  {
    what: "SMS and WhatsApp",
    why: "A message costs us money before it reaches anybody, so an unfunded account cannot send one. Accounts that sign in another way are unaffected.",
  },
  {
    what: "Anything metered above the free tier accrues",
    why: "It is not refused, it is owed. The balance goes negative and an invoice follows, which is a conversation rather than an outage.",
  },
];

/*
 * Topping up.
 */

/** The smallest useful amount. Below this the card fee is most of the transaction. */
export const MIN_TOPUP_CENTS = 1000;

export const TOPUP_PRESETS_CENTS: readonly number[] = [2000, 5000, 10_000, 25_000];

export type TopUpIssue = "amount_too_small" | "amount_invalid";

export const TOPUP_ISSUE_LABELS: Record<TopUpIssue, string> = {
  amount_invalid: "An amount to add, in whole dollars.",
  amount_too_small: `The smallest top-up is ${formatCents(MIN_TOPUP_CENTS)}. Below that the card fee is most of the transaction.`,
};

export function validateTopUp(cents: number): TopUpIssue | null {
  if (!Number.isFinite(cents) || cents <= 0 || !Number.isInteger(cents)) return "amount_invalid";
  return cents < MIN_TOPUP_CENTS ? "amount_too_small" : null;
}

export interface AutoTopUp {
  enabled: boolean;
  /** Charge when the balance falls below this, in cents. */
  thresholdCents: number;
  /** How much to add, in cents. */
  amountCents: number;
}

export type AutoTopUpIssue = "no_card" | "amount_below_threshold" | "amount_too_small";

export const AUTO_TOPUP_ISSUE_LABELS: Record<AutoTopUpIssue, string> = {
  no_card: "A card has to be on file before this can charge one.",
  amount_below_threshold:
    "The top-up has to be at least the threshold, or the balance lands back under it and charges again straight away.",
  amount_too_small: TOPUP_ISSUE_LABELS.amount_too_small,
};

/**
 * Whether an auto top-up would work. The threshold rule is the one worth enforcing: an
 * amount smaller than the trigger charges the card in a loop, and every one of those is a
 * fee.
 */
/**
 * How often an automatic top-up would fire at the month's rate, in days. Infinity where
 * nothing is being spent, because a rule that never fires has no interval.
 *
 * The figure that makes the two amounts mean something. A hundred dollars is a number; a
 * hundred dollars every three days is a decision, and it is the one somebody is really
 * making when they set the amount.
 */
export function topUpEveryDays(amountCents: number, projectedMonthCents: number): number {
  if (projectedMonthCents <= 0 || amountCents <= 0) return Number.POSITIVE_INFINITY;
  return (amountCents / projectedMonthCents) * 30;
}

/** The same, as the sentence under the field. */
export function topUpEveryWords(amountCents: number, projectedMonthCents: number): string {
  const days = topUpEveryDays(amountCents, projectedMonthCents);
  if (!Number.isFinite(days)) return "Nothing is being spent, so it would not fire.";
  if (days < 1) return "That would charge more than once a day at this month's rate.";
  if (days > 365) return "That would last more than a year at this month's rate.";
  const whole = Math.round(days);
  return `About once every ${whole} ${whole === 1 ? "day" : "days"} at this month's rate.`;
}

export function validateAutoTopUp(setting: AutoTopUp, hasCard: boolean): AutoTopUpIssue | null {
  if (!setting.enabled) return null;
  if (!hasCard) return "no_card";
  if (setting.amountCents < MIN_TOPUP_CENTS) return "amount_too_small";
  return setting.amountCents < setting.thresholdCents ? "amount_below_threshold" : null;
}

/*
 * The card.
 */

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "other";

export const CARD_BRAND_LABELS: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  other: "Card",
};

export interface PaymentCard {
  brand: CardBrand;
  /** The only four digits anybody here ever sees. */
  last4: string;
  expiryMonth: number;
  expiryYear: number;
  /** Who added it, for the audit trail's sake as much as the reader's. */
  addedBy: string;
  addedAt: string;
}

/**
 * Where a card, an address, a tax registration and a receipt are managed: the payment
 * provider's own hosted page.
 *
 * None of that is ours to build. The provider already has a portal that takes a card
 * number on its own origin, holds the billing address that decides the tax, and serves
 * every invoice as a PDF, and a second implementation here would be a second thing to keep
 * correct in two tax jurisdictions. What this panel owns is the balance and the rule that
 * tops it up; everything downstream of the charge is a link.
 */
export const BILLING_PORTAL_URL = "https://billing.idenzy.io/portal";

export function cardLabel(card: PaymentCard): string {
  return `${CARD_BRAND_LABELS[card.brand]} ending ${card.last4}`;
}

/** The month after the card's last valid one, as an instant. */
function expiryInstant(card: PaymentCard): Date {
  return new Date(card.expiryYear, card.expiryMonth, 1);
}

export function isCardExpired(card: PaymentCard, now: Date): boolean {
  return expiryInstant(card) <= now;
}

/**
 * Whether the card runs out inside two months.
 *
 * Worth its own state, because an expiring card and an automatic top-up fail together and
 * silently: the charge is declined, the balance runs out, and the first anybody hears is
 * an SMS that did not send.
 */
export function isCardExpiringSoon(card: PaymentCard, now: Date): boolean {
  if (isCardExpired(card, now)) return false;
  const twoMonths = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  return expiryInstant(card) <= twoMonths;
}

export function cardExpiryWords(card: PaymentCard): string {
  return `${String(card.expiryMonth).padStart(2, "0")}/${String(card.expiryYear).slice(-2)}`;
}

/*
 * Invoices.
 */

export type InvoiceStatus = "paid" | "open" | "past_due" | "void";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  paid: "Paid",
  open: "Open",
  past_due: "Past due",
  void: "Void",
};

export const INVOICE_STATUS_TONES: Record<
  InvoiceStatus,
  "success" | "neutral" | "error" | "warning"
> = {
  paid: "success",
  open: "neutral",
  past_due: "error",
  void: "warning",
};

export interface Invoice {
  id: string;
  /** What the customer quotes at us: the human number, not the id. */
  number: string;
  /** The month it covers. */
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  totalCents: number;
  currency: string;
  status: InvoiceStatus;
  /** Where the PDF is. Null while one is still being produced. */
  pdfUri: string | null;
}

export function isPastDue(invoice: Invoice): boolean {
  return invoice.status === "past_due";
}

/** What is owed across every invoice that is not settled, in cents. */
export function outstandingCents(invoices: readonly Invoice[]): number {
  return invoices
    .filter((invoice) => invoice.status === "open" || invoice.status === "past_due")
    .reduce((total, invoice) => total + invoice.totalCents, 0);
}

/*
 * Being told before it matters.
 */

/**
 * An alert and never a cap.
 *
 * The SMS screen has a hard spend cap because a message costs money before it reaches
 * anybody and stopping is the only way to stop paying. Here the equivalent lever would
 * mean refusing to authenticate somebody, which is not a thing this product does, so what
 * is offered is being told rather than being stopped.
 */
export interface SpendAlert {
  enabled: boolean;
  thresholdCents: number;
}

export function alertReached(alert: SpendAlert, spentCents: number): boolean {
  return alert.enabled && spentCents >= alert.thresholdCents;
}
