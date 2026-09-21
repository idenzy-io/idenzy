import {
  type AutoTopUp,
  alertReached,
  type Balance,
  BILLING_CURRENCY,
  isCardExpired,
  isCardExpiringSoon,
  isPastDue,
  methodForAuto,
  methodRemovalIssue,
  outstandingCents,
  type PaymentMethod,
  paymentRepair,
  type TopUpRequest,
  walletOf,
} from "~/utils/billing";
import { orgKindOf } from "~/utils/organisation";
import { billFor, monthBefore, periodAt, projectBill } from "~/utils/usage";

/**
 * The billing screens' one set of figures and writes, so four tabs agree with each other.
 *
 * Billing is a shell and four routes: the overview, the wallet, the methods and the
 * invoices. Each is its own page, and each reads the organisation's wallet, this month's
 * charges and the payment state; the balance the overview's tile shows is the balance
 * the wallet's fact band shows, and both are what the automatic top-up dialog is handed.
 * Deriving them in one place is what keeps that true, and it keeps the write helpers
 * beside the state they change so a tab arranges rather than wires.
 *
 * Every ref here is made per call rather than kept in `useState`: a dialog's busy flag or
 * the last top-up refusal belongs to the screen it happened on and must not follow the
 * reader to the next tab.
 *
 * `app/utils/billing.ts` holds every rule about money. This file holds none: it reads the
 * stores, sums the way the usage screen sums, and hands the results over.
 */
export function useBillingScreen() {
  const projects = useProjectStore();
  const store = useBillingStore();
  const usage = useUsageStore();
  const members = useMembersStore();

  const now = useNow({ interval: 60_000 });

  const org = computed(() => projects.currentOrg);
  const held = computed(() => projects.projectsOf(org.value.id));
  const kind = computed(() => orgKindOf(members.forOrg(org.value.id).length));

  const grants = computed(() => store.grantsFor(org.value.id));
  const wallet = computed(() => walletOf(grants.value, now.value, store.debtFor(org.value.id)));
  const methods = computed(() => store.methodsFor(org.value.id));
  const autoTopUp = computed(() => store.autoTopUpFor(org.value.id));
  const alert = computed(() => store.alertFor(org.value.id));
  const invoices = computed(() => store.invoicesFor(org.value.id));
  const lastSaved = computed(() => store.lastSavedAt(org.value.id));

  /*
   * The month's figures, read off each project's own bill rather than counted again, to
   * the same hour, so these screens and Usage cannot be a cent apart.
   */

  const asOf = computed(() => (usage.updatedAt ? new Date(usage.updatedAt) : now.value));

  const MONTH = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const monthLabel = computed(() => MONTH.format(asOf.value));

  const projectCharges = computed(() =>
    held.value
      .map((project) => {
        const period = usage.forProject(project.id);
        return {
          project,
          actualCents: billFor(period).totalCents,
          projectedCents: projectBill(period, asOf.value).totalCents,
        };
      })
      .sort((left, right) => right.actualCents - left.actualCents),
  );

  const spentCents = computed(() =>
    projectCharges.value.reduce((total, entry) => total + entry.actualCents, 0),
  );
  const projectedCents = computed(() =>
    projectCharges.value.reduce((total, entry) => total + entry.projectedCents, 0),
  );

  /**
   * Last month at the same point, and where it ended, summed the same way. Null where no
   * project has a month behind it, so a tile shows no movement rather than a rise from
   * nothing.
   */
  const lastMonth = computed(() => {
    const at = monthBefore(asOf.value);
    const id = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
    let samePointCents = 0;
    let finalCents = 0;
    let found = false;
    for (const project of held.value) {
      const period = usage.periodsFor(project.id).find((entry) => entry.id === id);
      if (!period) continue;
      found = true;
      samePointCents += billFor(periodAt(period, at)).totalCents;
      finalCents += billFor(period).totalCents;
    }
    return found ? { samePointCents, finalCents } : null;
  });

  const balance = computed<Balance>(() => ({
    cents: wallet.value.totalCents,
    currency: BILLING_CURRENCY,
    spentThisMonthCents: spentCents.value,
    projectedMonthCents: projectedCents.value,
  }));

  const owed = computed(() => outstandingCents(invoices.value));
  const pastDue = computed(() => invoices.value.filter(isPastDue));

  /**
   * A failed payment takes the place of the runway rather than sitting beside it: an
   * estimate of how long the credit lasts, printed above an invoice nobody paid, is the
   * optimistic reading the note asks to remove.
   */
  const repair = computed(() => paymentRepair(invoices.value));

  const defaultMethod = computed(() => store.defaultMethodFor(org.value.id));
  const autoMethod = computed(() => methodForAuto(autoTopUp.value, methods.value));
  const alertTripped = computed(() => alertReached(alert.value, spentCents.value));

  function methodWarning(method: PaymentMethod): string {
    if (isCardExpired(method, now.value)) return "Expired. Nothing can charge it.";
    if (isCardExpiringSoon(method, now.value)) {
      return "Expires soon. A declined charge and an empty balance fail together and quietly.";
    }
    return "";
  }

  /*
   * Saving.
   */

  const busy = ref<Set<string>>(new Set());
  const saving = computed(() => busy.value.size > 0);

  function isBusy(key: string): boolean {
    return busy.value.has(key);
  }

  async function whileBusy(key: string, work: () => Promise<void>) {
    busy.value = new Set([...busy.value, key]);
    try {
      await work();
    } finally {
      busy.value = new Set([...busy.value].filter((entry) => entry !== key));
    }
  }

  /**
   * The provider's hosted page, which is where a card number is taken, on their origin.
   *
   * The URL is asked for rather than known: it is a session minted for this organisation
   * and it expires, which is what makes the card that comes back attributable to them.
   * `BILLING_PORTAL_URL` used to stand here and was a hostname nobody had registered.
   *
   * The same tab, not a new one. A card saved in a popup leaves the reader looking at a
   * page that does not know it happened, and the return URL is what brings them back to a
   * wallet that has re-read itself.
   */
  function openPortal(): Promise<void> {
    return whileBusy("portal", () => store.addMethod(org.value.id));
  }

  /*
   * Writes. Each returns once the store has answered, and none closes a dialog: the page
   * that opened one decides that, on the answer.
   */

  /** The refusal from the last top-up attempt, shown in the dialog rather than swallowed. */
  const topUpIssue = ref<string>("");

  /** True when the credit was added. False leaves the refusal in `topUpIssue`. */
  async function topUp(request: TopUpRequest): Promise<boolean> {
    let added = false;
    await whileBusy("topup", async () => {
      const issue = await store.topUp(org.value.id, request);
      topUpIssue.value = issue === null ? "" : issue;
      added = issue === null;
    });
    return added;
  }

  function saveAutoTopUp(setting: AutoTopUp): Promise<void> {
    return whileBusy("auto", () => store.setAutoTopUp(org.value.id, setting));
  }

  function setAutoEnabled(enabled: boolean): Promise<void> {
    return saveAutoTopUp({ ...autoTopUp.value, enabled });
  }

  function setAlertEnabled(enabled: boolean): Promise<void> {
    return whileBusy("alert", () => store.setAlert(org.value.id, { ...alert.value, enabled }));
  }

  function setAlertThreshold(dollars: number): Promise<void> {
    return whileBusy("alert", () =>
      store.setAlert(org.value.id, { ...alert.value, thresholdCents: dollars * 100 }),
    );
  }

  function makeDefault(id: string): Promise<void> {
    return whileBusy(id, () => store.setDefaultMethod(org.value.id, id));
  }

  function removalIssue(method: PaymentMethod) {
    return methodRemovalIssue(methods.value, method.id, autoTopUp.value);
  }

  function removeMethod(id: string): Promise<void> {
    return whileBusy(id, () => store.removeMethod(org.value.id, id));
  }

  return {
    store,
    usage,
    now,
    org,
    held,
    kind,
    grants,
    wallet,
    methods,
    autoTopUp,
    alert,
    invoices,
    lastSaved,
    asOf,
    monthLabel,
    projectCharges,
    spentCents,
    projectedCents,
    lastMonth,
    balance,
    owed,
    pastDue,
    repair,
    defaultMethod,
    autoMethod,
    alertTripped,
    methodWarning,
    saving,
    isBusy,
    openPortal,
    topUpIssue,
    topUp,
    saveAutoTopUp,
    setAutoEnabled,
    setAlertEnabled,
    setAlertThreshold,
    makeDefault,
    removalIssue,
    removeMethod,
  };
}
