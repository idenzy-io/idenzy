/**
 * The organisation's wallet: what credit it holds, what may charge it, and the invoices
 * its projects have produced (`orgs.billing_customer_id`, PROJECT.md 5.1).
 *
 * Keyed by organisation and never by project. One `billing_customer_id` sits on `orgs`,
 * so every project underneath draws on one balance, and an invoice covers the whole
 * organisation: the total is the sum of each project's own rounded total for that month,
 * which is what keeps this screen, the usage screen and the invoice one figure
 * (notes/usage.md).
 *
 * Cents throughout, the way the billing API hands them over. A float here rounds the
 * wrong way once and then disagrees with an invoice forever.
 *
 * What the month has drawn down is not computed here. It is the usage screen's bill, and
 * a second reading of the same meters would be a second number to explain.
 *
 * Nothing charges anything. `PAYMENTS.running` is false, so `topUp` refuses and returns
 * the reason instead of adding cents to a ref: a local balance that grew is exactly what
 * notes/settings-billing.md forbids as proof of a payment. The credit in the fixture is
 * granted rather than bought, and the two kinds say which they are.
 *
 * A placeholder until the management client exists, like every store here.
 */

import {
  type AutoTopUp,
  type CheckoutState,
  type CreditGrant,
  defaultMethodOf,
  type Invoice,
  PAYMENTS,
  type PaymentMethod,
  type SpendAlert,
  type TopUpIssue,
  type TopUpRequest,
  validateTopUpRequest,
  walletOf,
  withDefaultMethod,
  withMethod,
  withoutMethod,
} from "~/utils/billing";
import { DURATIONS } from "~/utils/time";
import { billFor } from "~/utils/usage";

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

const AUTO_TOPUP_DEFAULT: AutoTopUp = {
  enabled: false,
  thresholdCents: 2000,
  amountCents: 5000,
  methodId: null,
};

const ALERT_DEFAULT: SpendAlert = { enabled: false, thresholdCents: 5000 };

export const useBillingStore = defineStore("billing", () => {
  const usage = useUsageStore();
  const projects = useProjectStore();

  const grants = ref<Record<string, CreditGrant[]>>({});
  const methods = ref<Record<string, PaymentMethod[]>>({});
  const autoTopUp = ref<Record<string, AutoTopUp>>({});
  const alerts = ref<Record<string, SpendAlert>>({});
  /** Where a checkout got to, per organisation. Never `confirmed` while nothing charges. */
  const checkout = ref<Record<string, CheckoutState>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    grants.value = { org_hasan: hasanGrants(), org_acme: acmeGrants() };
    methods.value = { org_hasan: [], org_acme: acmeMethods() };
    autoTopUp.value = {
      org_hasan: { ...AUTO_TOPUP_DEFAULT },
      org_acme: {
        enabled: true,
        thresholdCents: 5000,
        amountCents: 10_000,
        methodId: "pm_acme_visa",
      },
    };
    alerts.value = {
      org_hasan: { enabled: false, thresholdCents: 5000 },
      org_acme: { enabled: true, thresholdCents: 15_000 },
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function grantsFor(orgId: string): CreditGrant[] {
    return grants.value[orgId] ?? [];
  }

  /**
   * What is left to spend, in cents. The app bar and the SMS readiness check read this.
   *
   * Summed from the grants rather than held as a figure of its own, because credit that
   * has expired is worth nothing and a stored total would keep counting it.
   */
  function balanceFor(orgId: string): number {
    return walletOf(grantsFor(orgId), new Date()).totalCents;
  }

  function methodsFor(orgId: string): PaymentMethod[] {
    return methods.value[orgId] ?? [];
  }

  function defaultMethodFor(orgId: string): PaymentMethod | null {
    return defaultMethodOf(methodsFor(orgId));
  }

  function autoTopUpFor(orgId: string): AutoTopUp {
    return autoTopUp.value[orgId] ?? { ...AUTO_TOPUP_DEFAULT };
  }

  function alertFor(orgId: string): SpendAlert {
    return alerts.value[orgId] ?? { ...ALERT_DEFAULT };
  }

  function checkoutFor(orgId: string): CheckoutState {
    return checkout.value[orgId] ?? (PAYMENTS.running ? "idle" : "unavailable");
  }

  /** Newest first, one per closed month, over every project the organisation holds. */
  function invoicesFor(orgId: string): Invoice[] {
    return invoicesFrom(orgId, monthsFor(orgId));
  }

  /**
   * Each closed month the organisation has, with the month's total across its projects.
   *
   * Per project and then summed, never recomputed from combined meters: each project's
   * lines are rounded once by `billFor` and the invoice is the sum of those rounded
   * totals, which is the rule the usage screen states and the only way the two agree.
   */
  function monthsFor(orgId: string): ClosedMonth[] {
    const byMonth = new Map<string, ClosedMonth>();
    for (const project of projects.projectsOf(orgId)) {
      for (const period of usage.periodsFor(project.id)) {
        if (!period.closed) continue;
        const totalCents = billFor(period).totalCents;
        const found = byMonth.get(period.id);
        if (found) {
          found.totalCents += totalCents;
        } else {
          byMonth.set(period.id, {
            id: period.id,
            start: period.start,
            end: period.end,
            totalCents,
          });
        }
      }
    }
    return [...byMonth.values()].sort(
      (left, right) => Date.parse(right.start) - Date.parse(left.start),
    );
  }

  function stamp(orgId: string) {
    lastSaved.value = { ...lastSaved.value, [orgId]: new Date().toISOString() };
  }

  /**
   * Would add credit, and does not.
   *
   * Returns the refusal rather than throwing, so the dialog can put the reason beside a
   * disabled action. Nothing is written: no grant, no balance, no stamp. A store that
   * added the cents and reported success would be the defect the note names first.
   */
  async function topUp(orgId: string, request: TopUpRequest): Promise<TopUpIssue | null> {
    const issue = validateTopUpRequest(request);
    if (issue !== null) {
      checkout.value = {
        ...checkout.value,
        [orgId]: issue === "unavailable" ? "unavailable" : "failed",
      };
      return issue;
    }
    /* Unreachable while `PAYMENTS.running` is false, and written out so the shape is
       here when a provider is connected: the charge is started, the provider answers,
       and the credit arrives from that answer rather than from this call. */
    checkout.value = { ...checkout.value, [orgId]: "processing" };
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    checkout.value = { ...checkout.value, [orgId]: "unavailable" };
    return "unavailable";
  }

  function resetCheckout(orgId: string) {
    checkout.value = { ...checkout.value, [orgId]: PAYMENTS.running ? "idle" : "unavailable" };
  }

  /**
   * Records a method the provider handed back. The number never reaches this panel: what
   * arrives is a token, a brand and four digits.
   */
  async function addMethod(orgId: string, method: PaymentMethod): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    methods.value = { ...methods.value, [orgId]: withMethod(methodsFor(orgId), method) };
    stamp(orgId);
  }

  /** Makes one the default, in one change, so there is never a moment with two or none. */
  async function setDefaultMethod(orgId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    methods.value = { ...methods.value, [orgId]: withDefaultMethod(methodsFor(orgId), id) };
    stamp(orgId);
  }

  /**
   * Takes a method off, promoting another where it was the default.
   *
   * Removing the last one also switches off anything that would have charged it, because
   * a rule that cannot fire is worse than one that is plainly off.
   */
  async function removeMethod(orgId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const next = withoutMethod(methodsFor(orgId), id);
    methods.value = { ...methods.value, [orgId]: next };
    if (next.length === 0) {
      autoTopUp.value = { ...autoTopUp.value, [orgId]: { ...autoTopUpFor(orgId), enabled: false } };
    } else if (autoTopUpFor(orgId).methodId === id) {
      autoTopUp.value = { ...autoTopUp.value, [orgId]: { ...autoTopUpFor(orgId), methodId: null } };
    }
    stamp(orgId);
  }

  async function setAutoTopUp(orgId: string, setting: AutoTopUp): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    autoTopUp.value = { ...autoTopUp.value, [orgId]: setting };
    stamp(orgId);
  }

  async function setAlert(orgId: string, alert: SpendAlert): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    alerts.value = { ...alerts.value, [orgId]: alert };
    stamp(orgId);
  }

  function lastSavedAt(orgId: string): string | null {
    return lastSaved.value[orgId] ?? null;
  }

  return {
    loading,
    grantsFor,
    balanceFor,
    methodsFor,
    defaultMethodFor,
    autoTopUpFor,
    alertFor,
    checkoutFor,
    invoicesFor,
    monthsFor,
    topUp,
    resetCheckout,
    addMethod,
    setDefaultMethod,
    removeMethod,
    setAutoTopUp,
    setAlert,
    lastSavedAt,
  };
});

/*
 * The placeholder.
 */

interface ClosedMonth {
  id: string;
  start: string;
  end: string;
  totalCents: number;
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DURATIONS.DAY).toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DURATIONS.DAY).toISOString();
}

/**
 * A personal organisation: credit granted at sign-up, part of it promotional and running
 * out, which is the state the expiry warning exists for.
 */
function hasanGrants(): CreditGrant[] {
  return [
    {
      id: "cg_hasan_trial",
      kind: "promotional",
      amountCents: 2500,
      remainingCents: 1800,
      grantedAt: daysAgo(21),
      expiresAt: daysFromNow(9),
      note: "Sign-up credit",
    },
    {
      id: "cg_hasan_top",
      kind: "purchased",
      amountCents: 15_000,
      remainingCents: 12_840,
      grantedAt: daysAgo(40),
      expiresAt: null,
      note: "Top-up",
    },
  ];
}

/** A team: a purchased balance running low, and a support credit that already expired. */
function acmeGrants(): CreditGrant[] {
  return [
    {
      id: "cg_acme_support",
      kind: "promotional",
      amountCents: 5000,
      remainingCents: 5000,
      grantedAt: daysAgo(90),
      expiresAt: daysAgo(12),
      note: "Credit raised by support",
    },
    {
      id: "cg_acme_top",
      kind: "purchased",
      amountCents: 50_000,
      remainingCents: 4_120,
      grantedAt: daysAgo(26),
      expiresAt: null,
      note: "Top-up",
    },
  ];
}

/** Two methods and one default, because the default is the thing worth being able to see. */
function acmeMethods(): PaymentMethod[] {
  const soon = new Date(Date.now() + 45 * DURATIONS.DAY);
  return [
    {
      id: "pm_acme_visa",
      brand: "visa",
      last4: "6411",
      expiryMonth: soon.getMonth() + 1,
      expiryYear: soon.getFullYear(),
      isDefault: true,
      addedBy: "Hasan Musluoglu",
      addedAt: "2026-03-14T10:20:00.000Z",
    },
    {
      id: "pm_acme_mc",
      brand: "mastercard",
      last4: "2087",
      expiryMonth: 4,
      expiryYear: 2030,
      isDefault: false,
      addedBy: "Ana Rodríguez",
      addedAt: "2026-07-02T09:05:00.000Z",
    },
  ];
}

/**
 * One invoice per closed month with something on it, issued the day after it closes. The
 * most recent is still open and the one before it went past due, because a list where
 * everything is paid never shows what the other two states look like.
 */
function invoicesFrom(orgId: string, months: readonly ClosedMonth[]): Invoice[] {
  const suffix = orgId.replace(/^org_/, "").slice(0, 4).toUpperCase();
  return months
    .filter((month) => month.totalCents > 0)
    .map((month, index): Invoice => {
      const number = `IDZ-${month.id.replace("-", "")}-${suffix}`;
      return {
        id: `in_${suffix.toLowerCase()}_${month.id}`,
        number,
        periodStart: month.start,
        periodEnd: month.end,
        issuedAt: new Date(Date.parse(month.end) + DURATIONS.DAY).toISOString(),
        totalCents: month.totalCents,
        currency: "USD",
        status: index === 0 ? "open" : index === 1 ? "past_due" : "paid",
        pdfUri: `https://invoices.idenzy.io/${number}.pdf`,
      };
    });
}
