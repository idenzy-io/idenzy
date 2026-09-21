import { toleranceCents } from "@idenzy/protocol/billing/price-list";

/** What the drawdown knows about an organisation's wallet at one instant. */
export interface WalletPosition {
  /** What is owed and undrawn, in cents. */
  readonly debtCents: number;
  /** Credit still available to cover it. */
  readonly creditCents: number;
  /** What the organisation was charged inside the tolerance window. */
  readonly chargedInWindowCents: number;
}

export interface SpendDecision {
  readonly spendable: boolean;
  /** Why not, where not. Operational text; never shown to an end user mid sign-in. */
  readonly reason: string;
}

/**
 * Whether an organisation may still spend on the metered channels (ADR-0014).
 *
 * Extracted from `WalletSolvency` when the gate became a projection: the control plane now
 * decides this and a cell reads the answer, so the arithmetic has two callers and had to stop
 * being a method on the reader. Two copies of a tolerance rule is how a gate comes to refuse in
 * one place and permit in another for the same balance.
 *
 * **Not a zero check, and that is the whole design.** An organisation may go into debt up to a
 * share of what it has recently been charged, so a card that expired on Friday does not stop SMS
 * on Saturday. Past the tolerance the metered channels refuse, because at that point the
 * alternative is spending money for somebody who has stopped paying.
 */
export class SpendTolerance {
  decide(position: WalletPosition): SpendDecision {
    // Nothing owed is the common case and settles it without the rest.
    if (position.debtCents <= 0) return { spendable: true, reason: "" };

    if (position.creditCents >= position.debtCents) {
      return { spendable: true, reason: "" };
    }

    const uncovered = position.debtCents - position.creditCents;
    const allowed = toleranceCents(position.chargedInWindowCents);
    if (uncovered <= allowed) return { spendable: true, reason: "" };

    return {
      spendable: false,
      reason: `Owed ${uncovered} cents beyond a tolerance of ${allowed}.`,
    };
  }
}
