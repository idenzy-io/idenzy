/**
 * What the organisation has to spend, what it is spending it on, and how it is paid for
 * (PROJECT.md 5.1, `orgs.billing_customer_id`).
 *
 * The wallet is the organisation's and never a project's. One `billing_customer_id` sits
 * on `orgs`, so two projects under one organisation draw on one balance, and a screen
 * that scoped the figure to a project would show a third of a bill and call it the bill.
 *
 * Money is in cents everywhere, the way the billing API hands it over, and the panel
 * never does arithmetic on a float. A dollar figure is produced at the last moment, for
 * display, by one function.
 *
 * The rule this file exists to state is what a balance at zero does. What stops is the
 * traffic that costs us money the moment it leaves, which is the same reasoning the SMS
 * spend cap is built on, pointed the other way. Authentication is the last thing to stop,
 * because stopping it takes a customer's own product down and takes their users with it —
 * people who have no relationship with us and no way to find out what happened.
 *
 * It used to say that authentication never stops, flatly, and that promise has been
 * withdrawn (risks.md 1). It was not one we had decided to keep: an organisation that never
 * pays costs real money for as long as it likes, and a business with no ability to stop
 * serving a non-payer has no commercial relationship. Nothing stops authentication today and
 * nothing can — there is no mechanism — so this copy says what is true now and stops
 * promising what happens next.
 *
 * The card is never ours to see. The field that takes a number belongs to the payment
 * provider; what this panel holds is a token, a brand and four digits, which is all that
 * can be shown and all that is worth storing.
 */

import type { AutoTopUpSuspension } from "@idenzy/protocol/enums/billing";

/*
 * Whether a charge can happen at all.
 */

export interface PaymentCapability {
  running: boolean;
  /** Why not, in the reader's words, for the strip that says so. */
  reason: string;
}

/**
 * Why a screen says nothing can take a card, where that is the answer.
 *
 * It is a reason and no longer a verdict. Whether payments run is the server's answer —
 * `wallet.provider` is null on a deployment with no keys — and a constant here saying
 * `running: false` outlived its truth the moment one was configured. The reason survives
 * because a disabled control still has to explain itself.
 */
export const PAYMENTS_UNAVAILABLE =
  "No payment provider is connected on this deployment, so nothing here can charge a card. The balance is credit granted to the account rather than money anybody has paid.";

/**
 * The states a real checkout passes through, named now so the screen is built against
 * them rather than against a boolean.
 *
 * A card payment is not one step. It can need the cardholder present for a 3-D Secure
 * challenge, it can be abandoned on the provider's page, and it can fail after being
 * accepted. A dialog that only knew "busy" would report success for all three, which is
 * the failure the note asks to design against.
 */
export type CheckoutState =
  | "unavailable"
  | "idle"
  | "processing"
  | "requires_action"
  | "confirmed"
  | "failed"
  | "cancelled";

export const CHECKOUT_STATE_LABELS: Record<CheckoutState, string> = {
  unavailable: "Unavailable",
  idle: "Not started",
  processing: "Processing",
  requires_action: "Confirm with your bank",
  confirmed: "Added",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const CHECKOUT_STATE_NOTES: Record<CheckoutState, string> = {
  unavailable: PAYMENTS_UNAVAILABLE,
  idle: "Nothing has been charged.",
  processing: "The provider has the charge. Leaving this page does not cancel it.",
  requires_action:
    "Your bank wants to check it is you. The credit arrives once that is answered, and not before.",
  confirmed: "The provider confirmed the charge and the credit is on the account.",
  failed: "The charge was refused. Nothing was taken and the balance is unchanged.",
  cancelled: "Nothing was charged and the balance is unchanged.",
};

/** Which states mean a charge is still in flight, so a second submission is refused. */
export function isCheckoutPending(state: CheckoutState): boolean {
  return state === "processing" || state === "requires_action";
}

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
 * spent, because an organisation inside the free tier has no runway to run out of and a
 * number there would be an invented worry.
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
 * What the balance is made of.
 */

export type CreditKind = "purchased" | "promotional";

export const CREDIT_KIND_LABELS: Record<CreditKind, string> = {
  purchased: "Purchased",
  promotional: "Promotional",
};

/** A chart slot each, because these are two nominal values and neither is an outcome. */
export const CREDIT_KIND_TONES: Record<CreditKind, string> = {
  purchased: "chart-1",
  promotional: "chart-3",
};

export const CREDIT_KIND_NOTES: Record<CreditKind, string> = {
  purchased: "Paid for. It stays on the account until it is drawn down.",
  promotional:
    "Granted rather than paid for, and it expires. What is left on the day it expires is lost, which is why it is drawn down before anything else.",
};

/**
 * One grant of credit, purchased or promotional.
 *
 * The balance is the sum of these rather than a number of its own, because "what is my
 * balance" and "how much of it disappears next Tuesday" are the same question asked
 * twice, and a single figure can only answer the first.
 */
export interface CreditGrant {
  id: string;
  kind: CreditKind;
  /** What it was worth when it was granted, in cents. */
  amountCents: number;
  /** What is left of it, in cents. */
  remainingCents: number;
  grantedAt: string;
  /** Promotional credit ends; purchased credit does not, and null says so. */
  expiresAt: string | null;
  /** Why it exists: a top-up, a trial, a credit raised by support. */
  note: string;
}

/** Inside this and an expiry is worth saying out loud rather than filing in a column. */
export const EXPIRY_SOON_DAYS = 14;

export function isGrantExpired(grant: CreditGrant, now: Date): boolean {
  return grant.expiresAt !== null && Date.parse(grant.expiresAt) <= now.getTime();
}

export function isGrantExpiringSoon(grant: CreditGrant, now: Date): boolean {
  if (grant.expiresAt === null || isGrantExpired(grant, now)) return false;
  const days = (Date.parse(grant.expiresAt) - now.getTime()) / 86_400_000;
  return days <= EXPIRY_SOON_DAYS;
}

/** What a grant has left that can still be spent. Expired credit is worth nothing. */
export function spendableCents(grant: CreditGrant, now: Date): number {
  if (isGrantExpired(grant, now)) return 0;
  return Math.max(0, grant.remainingCents);
}

/** The grants with something left on them that has not expired, for a list to show. */
export function liveGrants(grants: readonly CreditGrant[], now: Date): CreditGrant[] {
  return grants.filter((grant) => spendableCents(grant, now) > 0);
}

/**
 * The order credit is drawn down in: promotional first, and inside each kind the
 * soonest to expire first.
 *
 * Spend what would otherwise be lost before spending what keeps. Drawn down the other
 * way round, an account holding both would watch a promotional grant expire unused while
 * its purchased credit paid the bill, and the customer would be right to call that a
 * charge they should not have had.
 */
export function drawOrder(grants: readonly CreditGrant[], now: Date): CreditGrant[] {
  const rank = (grant: CreditGrant) => (grant.kind === "promotional" ? 0 : 1);
  const ends = (grant: CreditGrant) =>
    grant.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(grant.expiresAt);
  return liveGrants(grants, now).sort(
    (left, right) => rank(left) - rank(right) || ends(left) - ends(right),
  );
}

export interface Wallet {
  /**
   * The balance, in cents: spendable credit less what is owed. Negative is owed (ADR-0014).
   *
   * A balance below nought is not a failure state. It is an organisation that has spent past
   * its credit and is inside its tolerance, and a screen that floored this at nought would be
   * telling somebody they owe nothing while a drawdown says otherwise.
   */
  totalCents: number;
  /** What the grants hold, before the debt is taken off. */
  creditCents: number;
  /** What usage has cost beyond the credit that covered it. Never negative. */
  debtCents: number;
  /**
   * Usage priced live and not yet on the statement (ADR-0017). Already taken off `totalCents`,
   * so the headline is the live balance while the grants below it are the ledger's.
   */
  pendingCents: number;
  purchasedCents: number;
  promotionalCents: number;
  /** What expires inside `EXPIRY_SOON_DAYS`, in cents. */
  expiringSoonCents: number;
  /** When the next thing expires, or null where nothing does. */
  nextExpiryAt: string | null;
}

/**
 * What the account holds, split the way the reader asks about it.
 *
 * The debt comes from the server because nothing in a browser can compute it: it is produced
 * by the drawdown against meters this panel never sees. The grants are summed here so expiry
 * is read at the moment the screen is, which is the one thing a stale server figure gets wrong
 * on a tab left open overnight.
 */
export function walletOf(
  grants: readonly CreditGrant[],
  now: Date,
  debtCents = 0,
  pendingCents = 0,
): Wallet {
  const live = liveGrants(grants, now);
  const sum = (kind: CreditKind) =>
    live
      .filter((grant) => grant.kind === kind)
      .reduce((total, grant) => total + spendableCents(grant, now), 0);

  const expiring = live.filter((grant) => isGrantExpiringSoon(grant, now));
  const next = drawOrder(grants, now).find((grant) => grant.expiresAt !== null) ?? null;
  const creditCents = live.reduce((total, grant) => total + spendableCents(grant, now), 0);
  const debt = Math.max(0, debtCents);
  const pending = Math.max(0, pendingCents);

  return {
    totalCents: creditCents - debt - pending,
    creditCents,
    debtCents: debt,
    pendingCents: pending,
    purchasedCents: sum("purchased"),
    promotionalCents: sum("promotional"),
    expiringSoonCents: expiring.reduce((total, grant) => total + spendableCents(grant, now), 0),
    nextExpiryAt: next?.expiresAt ?? null,
  };
}

/** How a grant's end reads on its row: "Expires in 9 days", "Does not expire". */
export function expiryWords(grant: CreditGrant, now: Date): string {
  if (grant.expiresAt === null) return "Does not expire";
  if (isGrantExpired(grant, now)) return "Expired";
  const days = Math.floor((Date.parse(grant.expiresAt) - now.getTime()) / 86_400_000);
  if (days < 1) return "Expires today";
  return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
}

/*
 * What a zero balance does, and what it does not.
 */

export interface ZeroRule {
  what: string;
  why: string;
}

/** What an unpaid balance does not touch. The first list, because it is the one nobody believes. */
export const ZERO_KEEPS_WORKING: readonly ZeroRule[] = [
  {
    what: "Every sign-in, refresh and session",
    why: "Authentication is the last thing we would ever stop, because stopping it takes your product down and your users with it. Nothing about a balance refuses a sign-in today, and we would tell you well before that could ever change.",
  },
  {
    what: "The dashboard, the API and your keys",
    why: "You can still see what is happening and still turn things off. An account somebody cannot reach is one they cannot fix.",
  },
  {
    what: "Email on a domain you have verified",
    why: "A verification mail nobody can receive is a sign-up nobody can finish, which is the same outage by another route. Your own domain is not rationed over a balance.",
  },
];

/** What does stop, and it is the traffic that costs money the moment it leaves. */
export const ZERO_STOPS: readonly ZeroRule[] = [
  {
    what: "SMS and WhatsApp",
    why: "A message costs us money before it reaches anybody, so an unfunded account cannot send one. Accounts that sign in another way are unaffected.",
  },
  {
    what: "Email on the shared sender, whatever the balance",
    why: "mail.idenzy.io is a sandbox to build against and is capped at a small burst and a couple of hundred a day, for everybody. It is not a payment control: one project mailing a bad list puts every other project's verification mail in spam. Verify a domain of your own before you ship.",
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

/** The one currency the account is held in. Set at the provider and not from here. */
export const BILLING_CURRENCY = "USD";

export type TopUpIssue = "amount_too_small" | "amount_invalid" | "no_method" | "unavailable";

export const TOPUP_ISSUE_LABELS: Record<TopUpIssue, string> = {
  amount_invalid: "An amount to add, in whole dollars.",
  amount_too_small: `The smallest top-up is ${formatCents(MIN_TOPUP_CENTS)}. Below that the card fee is most of the transaction.`,
  no_method: "A payment method has to be on the account before anything can charge one.",
  unavailable: PAYMENTS_UNAVAILABLE,
};

export function validateTopUp(cents: number): TopUpIssue | null {
  if (!Number.isFinite(cents) || cents <= 0 || !Number.isInteger(cents)) return "amount_invalid";
  return cents < MIN_TOPUP_CENTS ? "amount_too_small" : null;
}

/**
 * What a top-up actually asks for: an amount, the method it charges and the account it
 * lands on.
 *
 * The method is named in the request rather than assumed to be the default, because the
 * dialog offers a choice and a charge made to a different card from the one the reader
 * picked is the one mistake here nobody would forgive.
 */
export interface TopUpRequest {
  amountCents: number;
  currency: string;
  methodId: string | null;
}

/**
 * Whether a top-up could be attempted at all, in the order the reader can act on.
 *
 * `running` is passed in rather than read from a constant, because it is the server's
 * answer about this deployment and this file holds rules rather than state.
 *
 * A card on file is no longer one of the conditions. It was, while the shape in mind was
 * charging a saved card; a hosted checkout lets the cardholder pick one on the provider's
 * page, including a card nobody has used here before, so demanding one first would refuse
 * the only route a new customer has.
 */
export function validateTopUpRequest(request: TopUpRequest, running: boolean): TopUpIssue | null {
  const amount = validateTopUp(request.amountCents);
  if (amount !== null) return amount;
  return running ? null : "unavailable";
}

export interface AutoTopUp {
  enabled: boolean;
  /** Charge when the balance falls below this, in cents. */
  thresholdCents: number;
  /** How much to add, in cents. */
  amountCents: number;
  /** Which method it charges. Null falls back to the default, and says so. */
  methodId: string | null;
}

export type AutoTopUpIssue =
  | "no_card"
  | "amount_below_threshold"
  | "amount_too_small"
  | "method_expired";

export const AUTO_TOPUP_ISSUE_LABELS: Record<AutoTopUpIssue, string> = {
  no_card: "A payment method has to be on the account before this can charge one.",
  amount_below_threshold:
    "The top-up has to be at least the threshold, or the balance lands back under it and charges again straight away.",
  amount_too_small: TOPUP_ISSUE_LABELS.amount_too_small,
  method_expired:
    "The method this would charge has expired. A declined charge and an empty balance fail together and quietly.",
};

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

/** The line under the balance while some of it is usage the statement has not caught up with. */
export function pendingWords(pendingCents: number): string | null {
  if (pendingCents <= 0) return null;
  return `Includes ${formatCents(pendingCents)} of usage not yet on your statement.`;
}

/**
 * Why the automatic rule stopped itself, and what to do about it, in one sentence.
 *
 * Every reason is a case where charging again could not help or would do harm, so the fix is
 * always a person's: a different card, a word with the bank, or a look at a dispute. Saving
 * the rule is what resumes it, and the sentence says so because nothing else on the screen
 * would.
 */
export function autoTopUpPausedWords(reason: AutoTopUpSuspension): string {
  const resume = "Save the rule again to resume it.";
  switch (reason) {
    case "authentication_required":
      return `Paused: the bank wants the cardholder to approve each charge, which cannot happen unattended. Add credit by hand once, or use another card. ${resume}`;
    case "repeated_failure":
      return `Paused after three declines in a row, so the card is not tried again unattended. Check the card or choose another. ${resume}`;
    case "no_payment_method":
      return `Paused: there is no card it can charge, or the card has expired. Add or choose a card. ${resume}`;
    case "dispute":
      return `Paused because a charge on this account is disputed with the bank. ${resume}`;
    case "fraud_review":
      return `Paused because a payment was flagged in a fraud review. ${resume}`;
    case "refunded":
      return `Paused because a top-up was refunded, so the card is not charged straight back. ${resume}`;
  }
}

/**
 * Whether an auto top-up would work. The threshold rule is the one worth enforcing: an
 * amount smaller than the trigger charges the card in a loop, and every one of those is a
 * fee.
 */
export function validateAutoTopUp(setting: AutoTopUp, hasCard: boolean): AutoTopUpIssue | null {
  if (!setting.enabled) return null;
  if (!hasCard) return "no_card";
  if (setting.amountCents < MIN_TOPUP_CENTS) return "amount_too_small";
  return setting.amountCents < setting.thresholdCents ? "amount_below_threshold" : null;
}

/**
 * Whether the rule would fire the moment it is saved, and what that costs.
 *
 * The note asks for this by name: somebody setting a threshold above the balance they
 * already hold has written a charge, not a safety net, and the dialog has to say so
 * before the write rather than after it.
 */
export interface AutoTopUpEffect {
  /** The balance is already under the threshold, so saving charges straight away. */
  firesNow: boolean;
  /** What the balance would be afterwards, in cents. */
  balanceAfterCents: number;
}

export function autoTopUpEffect(setting: AutoTopUp, balanceCents: number): AutoTopUpEffect {
  const firesNow = setting.enabled && balanceCents < setting.thresholdCents;
  return {
    firesNow,
    balanceAfterCents: firesNow ? balanceCents + setting.amountCents : balanceCents,
  };
}

/*
 * Payment methods.
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
 * A card on the account, of which there may be several and exactly one is the default.
 *
 * The default is the one anything automatic charges, so it is a property of the set
 * rather than of a card: two defaults is an argument about which one an unattended
 * charge used, and none is an automatic top-up that silently cannot fire.
 */
export interface PaymentMethod extends PaymentCard {
  id: string;
  isDefault: boolean;
}

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

/** The default, or null on an account holding none. */
export function defaultMethodOf(methods: readonly PaymentMethod[]): PaymentMethod | null {
  return methods.find((method) => method.isDefault) ?? null;
}

/**
 * Makes one the default and the rest not, in a single change.
 *
 * One act rather than a clear and a set, for the same reason ownership moves by transfer
 * on the members screen: there is never a moment with two defaults and never one with
 * none, including the moment in the middle.
 */
export function withDefaultMethod(methods: readonly PaymentMethod[], id: string): PaymentMethod[] {
  if (!methods.some((method) => method.id === id)) return [...methods];
  return methods.map((method) => ({ ...method, isDefault: method.id === id }));
}

/**
 * Takes one off, and promotes another where the one removed was the default.
 *
 * An account left holding cards and no default is one where an automatic top-up stops
 * firing without anybody switching it off, so the promotion is part of the removal
 * rather than a thing to remember afterwards.
 */
export function withoutMethod(methods: readonly PaymentMethod[], id: string): PaymentMethod[] {
  const remaining = methods.filter((method) => method.id !== id);
  if (remaining.length === 0 || remaining.some((method) => method.isDefault)) return remaining;
  const first = remaining[0];
  return first ? withDefaultMethod(remaining, first.id) : remaining;
}

/** Adds one, and makes it the default when it is the first the account has held. */
export function withMethod(
  methods: readonly PaymentMethod[],
  method: PaymentMethod,
): PaymentMethod[] {
  const next = [...methods, { ...method, isDefault: method.isDefault || methods.length === 0 }];
  return method.isDefault ? withDefaultMethod(next, method.id) : next;
}

export type MethodRemovalIssue = "last_method_with_auto" | "not_found";

export const METHOD_REMOVAL_ISSUE_LABELS: Record<MethodRemovalIssue, string> = {
  last_method_with_auto:
    "This is the only method on the account and automatic top-up is on. Removing it would leave a rule that cannot fire, so switch the rule off first or add another method.",
  not_found: "That method is not on this account.",
};

/** Whether a method may be removed, and why not when it may not. */
export function methodRemovalIssue(
  methods: readonly PaymentMethod[],
  id: string,
  auto: AutoTopUp,
): MethodRemovalIssue | null {
  if (!methods.some((method) => method.id === id)) return "not_found";
  if (methods.length === 1 && auto.enabled) return "last_method_with_auto";
  return null;
}

/** What an automatic rule would actually charge: its own method, or the default. */
export function methodForAuto(
  setting: AutoTopUp,
  methods: readonly PaymentMethod[],
): PaymentMethod | null {
  if (setting.methodId !== null) {
    return methods.find((method) => method.id === setting.methodId) ?? null;
  }
  return defaultMethodOf(methods);
}

/*
 * Invoices.
 */

export type InvoiceStatus = "draft" | "paid" | "open" | "past_due" | "void" | "uncollectible";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  /* The API never lists a draft; the label exists so the type is total, not to be seen. */
  draft: "Being prepared",
  paid: "Paid",
  open: "Open",
  past_due: "Past due",
  void: "Void",
  uncollectible: "Written off",
};

export const INVOICE_STATUS_TONES: Record<
  InvoiceStatus,
  "success" | "neutral" | "error" | "warning"
> = {
  draft: "neutral",
  paid: "success",
  open: "neutral",
  past_due: "error",
  void: "warning",
  uncollectible: "error",
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

/**
 * What a failed payment replaces the normal status with.
 *
 * The note is explicit that a past-due invoice takes the place of the runway rather than
 * sitting beside it: a repair action is what the reader needs, and an optimistic estimate
 * of how long the credit lasts is noise on top of a bill nobody paid.
 */
export function paymentRepair(invoices: readonly Invoice[]): string {
  const due = invoices.filter(isPastDue);
  if (due.length === 0) return "";
  const total = formatCents(due.reduce((sum, invoice) => sum + invoice.totalCents, 0));
  return due.length === 1
    ? `${due[0]?.number} is past due at ${total}. Settle it in the billing portal.`
    : `${due.length} invoices are past due, ${total} in total. Settle them in the billing portal.`;
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
