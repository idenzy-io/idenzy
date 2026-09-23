import { CreditKind } from "@idenzy/protocol/enums/billing";
import { CreditGrantRepository } from "../repository/credit-grant-repository.js";
import { UsageDrawdownRepository } from "../repository/usage-drawdown-repository.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";

/** How a debit was paid: what credit covered, and what it could not. Sums to the debit. */
export interface Debited {
  readonly fromCreditCents: number;
  readonly toDebtCents: number;
}

/** How a credit landed: what cleared debt, and what became spendable. Sums to the credit. */
export interface Credited {
  readonly settledDebtCents: number;
  readonly grantedCents: number;
}

export interface CreditSource {
  readonly currency: string;
  readonly topUpId: string | null;
  /** In the words the wallet screen shows. */
  readonly note: string;
  /** The same, for a credit that cleared debt first. The screen is asked why it added less. */
  readonly noteAfterDebt?: string;
}

/**
 * The two ways money moves through a wallet, written once (ADR-0014).
 *
 * **Out: credit first, and whatever it cannot cover becomes debt.** The drawdown, a refund and
 * a dispute all take money out, and they differ only in which grant they would rather take it
 * from. **In: debt first, and only the remainder becomes credit.** A top-up and a dispute that
 * was won both put money in, and an organisation $400 down that adds $500 has $100 to spend.
 *
 * Both used to be written inline — the debit in the drawdown and the credit in the webhook —
 * and a third and fourth copy for refunds and disputes is how the two sides of a wallet come
 * to disagree about which way round the arithmetic goes. Neither half commits anything: both
 * run inside the caller's transaction, beside whatever record says why the money moved,
 * because a balance that moved without its reason is a figure nobody can defend.
 */
export class WalletLedger {
  private readonly grants: CreditGrantRepository;
  private readonly drawdown: UsageDrawdownRepository;

  constructor(tx: Transaction, context: OrgContext) {
    this.grants = new CreditGrantRepository(tx, context);
    this.drawdown = new UsageDrawdownRepository(tx, context);
  }

  /**
   * Takes cents out: from spendable grants in draw order, the rest onto debt.
   *
   * `preferTopUpId` puts that purchase's own grant first. A refund reverses a purchase, so
   * the credit it bought is what should go, before anything bought separately.
   */
  async debit(cents: number, now: Date, preferTopUpId: string | null = null): Promise<Debited> {
    if (cents <= 0) return { fromCreditCents: 0, toDebtCents: 0 };

    const spendable = await this.grants.spendable(now, { lock: true });
    const ordered =
      preferTopUpId === null
        ? spendable
        : [
            ...spendable.filter((grant) => grant.topUpId === preferTopUpId),
            ...spendable.filter((grant) => grant.topUpId !== preferTopUpId),
          ];

    // `draw` is one conditional statement per grant and answers what it really took, so a
    // grant being spent by something else at the same moment cannot be over-drawn.
    let remaining = cents;
    for (const grant of ordered) {
      if (remaining <= 0) break;
      remaining -= await this.grants.draw(grant.id, Math.min(remaining, grant.remainingCents));
    }
    if (remaining > 0) await this.drawdown.adjustDebt(remaining);
    return { fromCreditCents: cents - remaining, toDebtCents: remaining };
  }

  /**
   * Puts cents in: onto debt first, the remainder as purchased credit.
   *
   * A credit wholly consumed by debt grants nothing and must not try — `credit_grants` checks
   * `amount_cents > 0`, and a zero grant would roll back the transaction recording a payment
   * the provider has already taken.
   */
  async credit(cents: number, source: CreditSource): Promise<Credited> {
    if (cents <= 0) return { settledDebtCents: 0, grantedCents: 0 };

    const debt = await this.drawdown.lockedDebtCents();
    const settled = Math.min(cents, debt);
    if (settled > 0) await this.drawdown.adjustDebt(-settled);

    const granted = cents - settled;
    if (granted > 0) {
      await this.grants.grant({
        kind: CreditKind.Purchased,
        amountCents: granted,
        currency: source.currency,
        topUpId: source.topUpId,
        note: settled === 0 ? source.note : (source.noteAfterDebt ?? source.note),
        // Purchased credit does not expire, so this is null rather than a date nobody chose.
        expiresAt: null,
      });
    }
    return { settledDebtCents: settled, grantedCents: granted };
  }

  /** Spendable credit less debt: the figure every balance tile shows, and it can be negative. */
  async balanceCents(now: Date): Promise<number> {
    return (await this.grants.balanceCents(now)) - (await this.drawdown.debtCents());
  }
}
