/**
 * The account's balance, the card behind it, the invoices it has produced and who they
 * are made out to (`orgs.billing_customer_id`, PROJECT.md 5.1).
 *
 * Cents throughout, the way the billing API hands them over. A float here rounds the
 * wrong way once and then disagrees with an invoice forever.
 *
 * What the month has drawn down is not computed here. It is the usage screen's bill, and
 * a second reading of the same meters would be a second number to explain.
 *
 * The card is a token, a brand and four digits: enough to say which card is on file and
 * nothing more. The number, the billing address and the tax registration are the payment
 * provider's, held on their side and changed on their hosted page, so there is nothing
 * here that could hold any of them.
 *
 * A placeholder until the management client exists, like every store here.
 */

import type { AutoTopUp, Invoice, PaymentCard, SpendAlert } from "~/utils/billing";

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const useBillingStore = defineStore("billing", () => {
  /** What is left, in cents. The app bar reads the same figure. */
  const balanceCents = ref<Record<string, number>>({});
  const cards = ref<Record<string, PaymentCard | null>>({});
  const autoTopUp = ref<Record<string, AutoTopUp>>({});
  const alerts = ref<Record<string, SpendAlert>>({});
  const invoices = ref<Record<string, Invoice[]>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    balanceCents.value = { prj_personal: 12_840, prj_acme: 4_120 };
    cards.value = { prj_personal: null, prj_acme: acmeCard() };
    autoTopUp.value = {
      prj_personal: { enabled: false, thresholdCents: 2000, amountCents: 5000 },
      prj_acme: { enabled: true, thresholdCents: 5000, amountCents: 10_000 },
    };
    alerts.value = {
      prj_personal: { enabled: false, thresholdCents: 5000 },
      prj_acme: { enabled: true, thresholdCents: 15_000 },
    };
    invoices.value = { prj_personal: [], prj_acme: acmeInvoices() };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function balanceFor(projectId: string): number {
    return balanceCents.value[projectId] ?? 0;
  }

  function cardFor(projectId: string): PaymentCard | null {
    return cards.value[projectId] ?? null;
  }

  function autoTopUpFor(projectId: string): AutoTopUp {
    return (
      autoTopUp.value[projectId] ?? { enabled: false, thresholdCents: 2000, amountCents: 5000 }
    );
  }

  function alertFor(projectId: string): SpendAlert {
    return alerts.value[projectId] ?? { enabled: false, thresholdCents: 5000 };
  }

  function invoicesFor(projectId: string): Invoice[] {
    return invoices.value[projectId] ?? [];
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  /** Charges the card and adds the credit. One act, because half of it is not useful. */
  async function topUp(projectId: string, cents: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    balanceCents.value = { ...balanceCents.value, [projectId]: balanceFor(projectId) + cents };
    stamp(projectId);
  }

  /**
   * Replaces the card. What arrives is what the provider hands back after taking the
   * number in its own field: a brand and four digits, never a number.
   */
  async function saveCard(projectId: string, card: PaymentCard): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    cards.value = { ...cards.value, [projectId]: card };
    stamp(projectId);
  }

  /** Taking the card off also switches off anything that would have charged it. */
  async function removeCard(projectId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    cards.value = { ...cards.value, [projectId]: null };
    autoTopUp.value = {
      ...autoTopUp.value,
      [projectId]: { ...autoTopUpFor(projectId), enabled: false },
    };
    stamp(projectId);
  }

  async function setAutoTopUp(projectId: string, setting: AutoTopUp): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    autoTopUp.value = { ...autoTopUp.value, [projectId]: setting };
    stamp(projectId);
  }

  async function setAlert(projectId: string, alert: SpendAlert): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    alerts.value = { ...alerts.value, [projectId]: alert };
    stamp(projectId);
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return {
    balanceCents,
    loading,
    balanceFor,
    cardFor,
    autoTopUpFor,
    alertFor,
    invoicesFor,
    topUp,
    saveCard,
    removeCard,
    setAutoTopUp,
    setAlert,
    lastSavedAt,
  };
});

/*
 * The placeholder.
 */

/** Expiring inside two months, because that is the state the warning exists for. */
function acmeCard(): PaymentCard {
  const soon = new Date(Date.now() + 45 * 86_400_000);
  return {
    brand: "visa",
    last4: "6411",
    expiryMonth: soon.getMonth() + 1,
    expiryYear: soon.getFullYear(),
    addedBy: "Hasan Musluoglu",
    addedAt: "2026-03-14T10:20:00.000Z",
  };
}

function monthStart(monthsAgo: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
}

const TOTALS_CENTS = [4187, 3902, 4460, 3311, 2874, 1990];

function acmeInvoices(): Invoice[] {
  return TOTALS_CENTS.map((totalCents, index) => {
    const start = monthStart(index + 1);
    const end = monthStart(index);
    const issuedAt = new Date(end.getTime() + 86_400_000);
    /* The most recent one is still open and the one before it went past due, because a
       list where everything is paid never shows what the two other states look like. */
    const status = index === 0 ? "open" : index === 1 ? "past_due" : "paid";
    return {
      id: `in_${String(index).padStart(4, "0")}`,
      number: `IDZ-2026-${String(120 - index).padStart(4, "0")}`,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      issuedAt: issuedAt.toISOString(),
      totalCents,
      currency: "USD",
      status,
      pdfUri: `https://invoices.idenzy.io/IDZ-2026-${String(120 - index).padStart(4, "0")}.pdf`,
    };
  });
}
