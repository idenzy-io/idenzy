/**
 * The organisation's money, as the four billing tabs read and write it (PROJECT.md 5.1).
 *
 * **Everything is the management API's now.** The balance is what the credit grants say,
 * the cards are what the provider holds, and the invoices are what was issued — none of it
 * is derived from usage any more. That was the placeholder's shape and it had to be: with
 * nothing that charges, an invoice could only be a sum of closed periods, which is a
 * forecast wearing an invoice's clothes.
 *
 * **Nothing here adds a cent to a ref.** Adding credit asks the API for a hosted page and
 * sends the browser to it; the credit arrives when the provider tells the server it was
 * paid, and this store learns about it by reading the wallet again. That is the note's
 * first finding kept true at the only layer that can keep it true — a changed local
 * balance must never read as proof of a payment (notes/settings-billing.md P1).
 *
 * **The card number never reaches this panel.** There is no add-card form and no token to
 * post: `startCardSetup` answers with a URL to leave for, because the provider's own page
 * is the only place a card is typed.
 *
 * `running` is the server's answer and not a constant. A deployment with no payment
 * provider is a correct one, and the screens are built to say so rather than to offer a
 * control that would fail.
 */

import type {
  AutoTopUp as ApiAutoTopUp,
  Invoice as ApiInvoice,
  PaymentMethod as ApiPaymentMethod,
  SpendAlert as ApiSpendAlert,
  Wallet as ApiWallet,
  AutoTopUpStatus,
  HostedCheckout,
  InvoiceList,
} from "@idenzy/protocol/schemas/billing";
import {
  type AutoTopUp,
  type CheckoutState,
  type CreditGrant,
  defaultMethodOf,
  type Invoice,
  type PaymentMethod,
  type SpendAlert,
  type TopUpIssue,
  type TopUpRequest,
  validateTopUpRequest,
} from "~/utils/billing";
import { managementMessage } from "~/utils/sign-in-errors";

/* What a project that has configured nothing reads as, matching the server's own
   defaults: off, and a threshold under the amount so switching it on is one decision. */
const AUTO_TOPUP_DEFAULT: AutoTopUp = {
  enabled: false,
  thresholdCents: 2000,
  amountCents: 5000,
  methodId: null,
};

const ALERT_DEFAULT: SpendAlert = { enabled: false, thresholdCents: 5000 };

export const useBillingStore = defineStore("billing", () => {
  const bootstrap = useBootstrapStore();
  const projects = useProjectStore();
  const members = useMembersStore();

  const wallets = ref<Record<string, ApiWallet>>({});
  const invoices = ref<Record<string, Invoice[]>>({});
  const checkout = ref<Record<string, CheckoutState>>({});
  const loading = ref(true);
  const refusal = ref<string | null>(null);
  const lastSaved = ref<Record<string, string>>({});
  /** Non-reactive on purpose: mutating a ref inside a computed re-invalidates the computed. */
  const requested = new Set<string>();

  function basePath(orgId: string): string {
    return `/v1/orgs/${orgId}/billing`;
  }

  function present(method: ApiPaymentMethod): PaymentMethod {
    return {
      id: method.id,
      brand: method.brand,
      last4: method.last4,
      expiryMonth: method.expiryMonth,
      expiryYear: method.expiryYear,
      isDefault: method.isDefault,
      /* The server answers with a member id resolved to a person, or null where that
         member has left. "Someone who has left" is the honest reading of null and is a
         normal row: a card outlives the person who added it. */
      addedBy: method.addedBy ?? "A former member",
      addedAt: method.addedAt,
    };
  }

  function presentInvoice(invoice: ApiInvoice): Invoice {
    return {
      id: invoice.id,
      number: invoice.number,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      issuedAt: invoice.issuedAt,
      totalCents: invoice.totalCents,
      currency: invoice.currency,
      status: invoice.status,
      pdfUri: invoice.pdfUri,
      hostedUrl: invoice.hostedUrl,
      dueAt: invoice.dueAt,
      paidAt: invoice.paidAt,
    };
  }

  async function load(orgId: string): Promise<void> {
    loading.value = true;
    refusal.value = null;
    try {
      const path = basePath(orgId);
      const api = useManagementApi();
      const { data, error } = await api(path).get().json<ApiWallet>();
      if (error.value !== null) throw error.value;
      if (data.value !== null) wallets.value = { ...wallets.value, [orgId]: data.value };

      const billed = await api(`${path}/invoices`).get().json<InvoiceList>();
      if (billed.error.value === null && billed.data.value !== null) {
        invoices.value = {
          ...invoices.value,
          [orgId]: billed.data.value.invoices.map(presentInvoice),
        };
      }
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  function ensure(orgId: string): void {
    if (requested.has(orgId)) return;
    requested.add(orgId);
    void load(orgId);
  }

  function walletOfOrg(orgId: string): ApiWallet | null {
    ensure(orgId);
    return wallets.value[orgId] ?? null;
  }

  /** Whether this deployment can charge a card at all. The server's answer, not a constant. */
  const running = computed(() => walletOfOrg(projects.currentOrg.id)?.provider !== null);

  function grantsFor(orgId: string): CreditGrant[] {
    return (walletOfOrg(orgId)?.grants ?? []).map((grant) => ({
      id: grant.id,
      kind: grant.kind,
      amountCents: grant.amountCents,
      remainingCents: grant.remainingCents,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt,
      note: grant.note,
    }));
  }

  /**
   * What is left to spend, in cents. The app bar and the SMS readiness check read this.
   *
   * The server's figure rather than a sum taken here. It is the same arithmetic, over the
   * same grants, with one difference that matters: expiry is decided against the database's
   * clock, so a browser left open overnight does not go on counting credit that has run out.
   */
  /**
   * The live balance: the wallet's when this session has loaded it, and otherwise the one
   * `/v1/me` answered on this visit — the same figure either way (ADR-0017), so the header can
   * show it without fetching a wallet it does not need.
   */
  function balanceFor(orgId: string): number {
    const wallet = walletOfOrg(orgId);
    if (wallet !== null) return wallet.balanceCents;
    const known = bootstrap.balanceOf(orgId);
    return known?.mode === "prepaid" ? known.balanceCents : 0;
  }

  /** Net terms in days for an organisation billed by invoice, or null for a prepaid one. */
  function invoicedTermsFor(orgId: string): number | null {
    const wallet = walletOfOrg(orgId);
    return wallet?.billingMode === "invoiced" ? wallet.invoiceTermsDays : null;
  }

  /** Usage priced live and not yet on the statement, in cents. Nought when unknown. */
  function pendingFor(orgId: string): number {
    const wallet = walletOfOrg(orgId);
    if (wallet !== null) return wallet.pendingCents ?? 0;
    const known = bootstrap.balanceOf(orgId);
    return known?.mode === "prepaid" ? (known.pendingCents ?? 0) : 0;
  }

  /**
   * What usage has cost beyond the credit that covered it, in cents.
   *
   * The server's figure and never a sum taken here: debt is produced by the drawdown against
   * meters this browser cannot see, and it is what makes `balanceFor` able to read negative.
   */
  function debtFor(orgId: string): number {
    return walletOfOrg(orgId)?.debtCents ?? 0;
  }

  function methodsFor(orgId: string): PaymentMethod[] {
    return (walletOfOrg(orgId)?.methods ?? []).map(present);
  }

  function defaultMethodFor(orgId: string): PaymentMethod | null {
    return defaultMethodOf(methodsFor(orgId));
  }

  function autoTopUpFor(orgId: string): AutoTopUp {
    const rule = walletOfOrg(orgId)?.autoTopUp;
    return rule === undefined ? { ...AUTO_TOPUP_DEFAULT } : { ...rule };
  }

  /** What the rule has been doing. Null until the wallet has loaded, or from an older API. */
  function autoTopUpStatusFor(orgId: string): AutoTopUpStatus | null {
    return walletOfOrg(orgId)?.autoTopUpStatus ?? null;
  }

  function alertFor(orgId: string): SpendAlert {
    const alert = walletOfOrg(orgId)?.spendAlert;
    return alert === undefined ? { ...ALERT_DEFAULT } : { ...alert };
  }

  function checkoutFor(orgId: string): CheckoutState {
    ensure(orgId);
    return checkout.value[orgId] ?? (running.value ? "idle" : "unavailable");
  }

  function invoicesFor(orgId: string): Invoice[] {
    ensure(orgId);
    return invoices.value[orgId] ?? [];
  }

  function outstandingFor(orgId: string): number {
    return walletOfOrg(orgId)?.outstandingCents ?? 0;
  }

  function stamp(orgId: string) {
    lastSaved.value = { ...lastSaved.value, [orgId]: new Date().toISOString() };
  }

  /**
   * Opens a charge and leaves for the page that takes it.
   *
   * The state goes to `processing` and stays there, because this tab is about to be
   * replaced by the provider's. What brings it back is the browser returning to the
   * success or cancel URL, which the wallet screen reads off the query and turns into the
   * state the reader sees — and the balance behind it is a fresh read rather than anything
   * this function guessed.
   */
  async function topUp(orgId: string, request: TopUpRequest): Promise<TopUpIssue | null> {
    const issue = validateTopUpRequest(request, running.value);
    if (issue !== null) {
      checkout.value = {
        ...checkout.value,
        [orgId]: issue === "unavailable" ? "unavailable" : "failed",
      };
      return issue;
    }
    checkout.value = { ...checkout.value, [orgId]: "processing" };
    try {
      const { data, error } = await useManagementApi()(`${basePath(orgId)}/top-ups`)
        .post({ amountCents: request.amountCents })
        .json<HostedCheckout>();
      if (error.value !== null) throw error.value;
      const url = data.value?.url;
      /* A 200 with no URL is not something to throw over: there is nothing the reader can
         do about it and nothing here that would carry a stable code. The checkout stays
         unstarted and says so, which is the same answer a refusal gives. */
      if (url === undefined || url.length === 0) {
        checkout.value = { ...checkout.value, [orgId]: "failed" };
        return "unavailable";
      }
      window.location.assign(url);
      return null;
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
      checkout.value = { ...checkout.value, [orgId]: "failed" };
      return "unavailable";
    }
  }

  function resetCheckout(orgId: string) {
    checkout.value = { ...checkout.value, [orgId]: running.value ? "idle" : "unavailable" };
  }

  /** Records what the browser came back to, so a reader is told rather than left guessing. */
  function settleCheckout(orgId: string, outcome: "success" | "cancel"): void {
    checkout.value = {
      ...checkout.value,
      /* Not `confirmed`. Landing on the success URL means the page was completed, not that
         the money moved — the provider says that on a webhook, and the balance below is
         what proves it. Saying "confirmed" here would be the simulated success the note
         puts first, one layer up from where it used to be. */
      [orgId]: outcome === "success" ? "processing" : "cancelled",
    };
    requested.delete(orgId);
    void load(orgId);
  }

  /**
   * A page that saves a card and charges nothing.
   *
   * There is no method to hand over, which is the whole point: the panel has no card field
   * and never will, so what this does is ask where to send the reader.
   */
  async function addMethod(orgId: string): Promise<void> {
    try {
      const { data, error } = await useManagementApi()(`${basePath(orgId)}/methods/setup`)
        .post({})
        .json<HostedCheckout>();
      if (error.value !== null) throw error.value;
      const url = data.value?.url;
      if (url !== undefined && url.length > 0) window.location.assign(url);
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    }
  }

  async function write(orgId: string, run: () => Promise<void>): Promise<void> {
    refusal.value = null;
    try {
      await run();
      requested.delete(orgId);
      await load(orgId);
      stamp(orgId);
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    }
  }

  /** Makes one the default, in one call, so there is never a moment with two or none. */
  async function setDefaultMethod(orgId: string, id: string): Promise<void> {
    await write(orgId, async () => {
      const { error } = await useManagementApi()(`${basePath(orgId)}/methods/${id}/default`).post(
        {},
      );
      if (error.value !== null) throw error.value;
    });
  }

  /**
   * Takes a method off, at the provider as well as here.
   *
   * The rule about the last card switching the automatic top-up off lives on the server
   * now, not in this function. It has to: a rule that cannot fire is a promise nobody
   * keeps, and a panel enforcing it would leave the promise broken for anything that is
   * not this panel.
   */
  async function removeMethod(orgId: string, id: string): Promise<void> {
    await write(orgId, async () => {
      const { error } = await useManagementApi()(`${basePath(orgId)}/methods/${id}`).delete();
      if (error.value !== null) throw error.value;
    });
  }

  async function setAutoTopUp(orgId: string, setting: AutoTopUp): Promise<void> {
    await write(orgId, async () => {
      const { error } = await useManagementApi()(`${basePath(orgId)}/auto-top-up`).put(
        setting satisfies ApiAutoTopUp,
      );
      if (error.value !== null) throw error.value;
    });
  }

  async function setAlert(orgId: string, alert: SpendAlert): Promise<void> {
    await write(orgId, async () => {
      const { error } = await useManagementApi()(`${basePath(orgId)}/spend-alert`).put(
        alert satisfies ApiSpendAlert,
      );
      if (error.value !== null) throw error.value;
    });
  }

  function lastSavedAt(orgId: string): string | null {
    return lastSaved.value[orgId] ?? null;
  }

  /* Read once so the store sees the team behind `addedBy`, which the server resolves but
     the members screen is what keeps current. */
  void members;

  return {
    loading,
    refusal,
    running,
    grantsFor,
    balanceFor,
    pendingFor,
    invoicedTermsFor,
    debtFor,
    methodsFor,
    defaultMethodFor,
    autoTopUpFor,
    autoTopUpStatusFor,
    alertFor,
    checkoutFor,
    invoicesFor,
    outstandingFor,
    topUp,
    resetCheckout,
    settleCheckout,
    addMethod,
    setDefaultMethod,
    removeMethod,
    setAutoTopUp,
    setAlert,
    lastSavedAt,
  };
});
