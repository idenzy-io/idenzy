/**
 * What the product costs, in one place (PROJECT.md 5.1, ADR-0014).
 *
 * **Shared rather than copied.** The panel priced a month with its own `FREE_MAU` and
 * `MAU_PRICE` while the server priced nothing at all, which was safe only while nothing
 * charged. Now that something does, a screen disagreeing with the ledger would be a
 * customer disputing a figure we showed them ourselves, so both read this.
 *
 * **Money is integer cents and rates are integer millicents.** A rate of $0.003 is not
 * representable in cents, so rates are held in **thousandths of a cent** — $0.003 is 0.3
 * cents is 300 — and every multiplication happens in integers before one division rounds at
 * the end. A float here rounds the wrong way once and then disagrees with a charge that has
 * already been taken. Millicents rather than any other sub-unit because
 * `invoice_lines.unit_rate_millicents` already is one, and two sub-units in one schema is a
 * conversion somebody eventually gets backwards.
 */

/** One band of a volume price. `upTo` is inclusive; the last band is unbounded. */
export interface PriceBand {
  /** The count this band runs to, or null for the band that has no ceiling. */
  readonly upTo: number | null;
  /** Thousandths of a cent per unit. $0.003 is 300; $0.0025 is 250; free is 0. */
  readonly rateMillicents: number;
}

/**
 * Monthly active users, banded, and the bands are the organisation's rather than a
 * project's (ADR-0014).
 *
 * Marginal and not a flat rate chosen by total volume: an organisation at 1,000,000 pays
 * the free allowance on its first 50,000, $0.003 on the next 200,000 and $0.0025 on the
 * 750,000 after that — $2,475 — rather than $0.0025 on everything past the allowance. The
 * difference is a hundred dollars a month at that size and grows with the customer, and
 * marginal is the shape that never makes one extra user cost more than the one before it.
 */
export const MAU_BANDS: readonly PriceBand[] = [
  { upTo: 50_000, rateMillicents: 0 },
  { upTo: 250_000, rateMillicents: 300 },
  { upTo: 1_000_000, rateMillicents: 250 },
  { upTo: null, rateMillicents: 200 },
];

/** Free on every organisation, forever. The first band, named for the screens. */
export const FREE_MAU = 50_000;

/**
 * Email, which is a **placeholder and is marked as one**.
 *
 * PROJECT.md 5.1 quotes $0.50 per 1,000 on the shared domain, and it has not been checked
 * against a real vendor bill. It is wired the way MAU is so settling it later is an edit to
 * this table, and it is declared rather than left out so nothing silently prices it at zero.
 */
export const EMAIL_SHARED_CENTS_PER_THOUSAND = 50;
export const EMAIL_CUSTOM_CENTS_PER_THOUSAND = 40;
export const EMAIL_CUSTOM_DOMAIN_CENTS_PER_MONTH = 500;

/**
 * The price of a month's active users, in whole cents.
 *
 * A pure function of the count, which is what makes the drawdown correct: a pass prices
 * the month as it now stands and charges the difference from what it has already charged,
 * so every band boundary is settled here and never in the job (ADR-0014).
 *
 * Rounding happens once, at the end, on the total. Rounding each band would let a customer
 * pay up to half a cent per band for the privilege of crossing one.
 */
export function mauCents(mau: number): number {
  if (!Number.isFinite(mau) || mau <= 0) return 0;
  const count = Math.floor(mau);
  let millicents = 0;
  let low = 0;
  for (const band of MAU_BANDS) {
    if (count <= low) break;
    const ceiling = band.upTo ?? count;
    millicents += (Math.min(count, ceiling) - low) * band.rateMillicents;
    low = ceiling;
    if (band.upTo === null) break;
  }
  // Millicents to cents, rounded half up, once, on the total.
  return Math.round(millicents / 1000);
}

/** How many of a month's active users are chargeable at all. For the screens' copy. */
export function billableMau(mau: number): number {
  return Math.max(0, Math.floor(mau) - FREE_MAU);
}

/** The price of messages sent on one of our sending domains, in whole cents. */
export function emailCents(sent: number, ownDomain: boolean): number {
  if (!Number.isFinite(sent) || sent <= 0) return 0;
  const rate = ownDomain ? EMAIL_CUSTOM_CENTS_PER_THOUSAND : EMAIL_SHARED_CENTS_PER_THOUSAND;
  return Math.round((Math.floor(sent) * rate) / 1000);
}

/**
 * How far into debt an organisation may go before anything stops (ADR-0014).
 *
 * A share of what it has been **charged** over the window, not of what it has paid in one.
 * Tolerance keyed on top-ups moves when a customer happens to pay: one that prepays
 * $10,000 on the first of January has rope until the 31st and none on the 1st of February,
 * having done nothing differently. Keyed on charges it tracks how much they actually use,
 * which is what the rope is for.
 */
export const TOLERANCE_SHARE_OF_RECENT_CHARGES = 0.2;
export const TOLERANCE_WINDOW_DAYS = 30;

/** A floor, so a new organisation's first overage is not also its first outage. */
export const TOLERANCE_FLOOR_CENTS = 5000;

/** What an organisation may owe before the metered channels refuse, in whole cents. */
export function toleranceCents(chargedInWindowCents: number): number {
  const share = Math.round(Math.max(0, chargedInWindowCents) * TOLERANCE_SHARE_OF_RECENT_CHARGES);
  return Math.max(TOLERANCE_FLOOR_CENTS, share);
}

/**
 * The same idea for authentication, and deliberately a larger share (risks.md 1, 3).
 *
 * Authentication is the last thing to stop, because stopping it does not inconvenience the
 * organisation that owes us money — it locks out every person who holds an account with them,
 * none of whom is our customer or has any way to find out what happened. So the rope is half
 * again as long: an organisation charged $1,000 over the window may owe $300 here against the
 * $200 that stops its SMS.
 *
 * The floor is the metered one doubled, for the same reason the metered one has a floor at
 * all — a new organisation's first overage should not be its first outage, and this outage is
 * the expensive one.
 *
 * **Nothing calls this yet, and that is deliberate.** The control it parameterises must not
 * ship before the three safeguards in risks.md 7 exist: a notification chain that has actually
 * run, an explicit hold a person can set, and a floor a customer cannot fall through by
 * accident. What is settled here is the arithmetic, so that when the control is built the
 * number is not also a decision being made at the same time.
 */
export const AUTH_TOLERANCE_SHARE_OF_RECENT_CHARGES = 0.3;
export const AUTH_TOLERANCE_FLOOR_CENTS = TOLERANCE_FLOOR_CENTS * 2;

/**
 * How many automatic top-ups an organisation may make in any rolling day, by default.
 *
 * Attempts and not successes: a declined charge is what an issuer counts, and a card charged
 * five times in an afternoon reads as card testing whether or not any of them went through.
 * Three covers a customer burning through a small top-up amount in a busy day; anything past
 * it wants a larger amount, not a fourth charge. A per-organisation override exists for
 * support to set, and nothing on the wire can.
 */
export const AUTO_TOP_UP_DAILY_LIMIT = 3;

/** What an organisation may owe before authentication itself would refuse, in whole cents. */
export function authToleranceCents(chargedInWindowCents: number): number {
  const share = Math.round(
    Math.max(0, chargedInWindowCents) * AUTH_TOLERANCE_SHARE_OF_RECENT_CHARGES,
  );
  return Math.max(AUTH_TOLERANCE_FLOOR_CENTS, share);
}
