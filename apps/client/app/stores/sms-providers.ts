/**
 * How each project's SMS actually leaves: our routing or an account of its own, and the
 * figures the providers screen shows beside it.
 *
 * The routing table itself is not here. It belongs to the deployment rather than to a
 * project, so it is a constant in `~/utils/sms-providers` until the management API serves
 * it; what this store holds is the one decision a project makes about it.
 *
 * The credential goes one way, as it does for a social provider: the panel is told that a
 * secret is stored and when it was written, never what it is. A placeholder until the
 * management client exists, like every store here.
 */

import {
  afterAccountRemoved,
  afterAccountSaved,
  type ByoAccount,
  type ByoDraft,
  type ByoVendor,
  byoVendorInfo,
  isByoKey,
  type SendingMode,
  type SendingState,
  type SmsProviderId,
  transportWired,
  withMode,
} from "~/utils/sms-providers";

export interface SmsTraffic {
  /** Over the last thirty days, oldest day first. */
  sent: number;
  sentDaily: number[];
  /** Accepted by the carrier. Not a read, and not a code anybody typed in. */
  delivered: number;
  failed: number;
  /** What the month cost, in the policy's currency. Zero on a project that brings its own. */
  spend: number;
  currency: string;
  byProvider: { id: SmsProviderId; count: number }[];
}

/**
 * What presenting the credentials to the vendor answered.
 *
 * A check and not a send: the real one asks the vendor who the credentials belong to,
 * which costs nothing and reaches nobody. It exists because a credential set saved
 * without one fails at the carrier on somebody's sign-in, hours later, after the message
 * has already been paid for (notes/sms-providers.md P1).
 */
export interface AccountCheck {
  ok: boolean;
  /** What the vendor answered, in the reader's words. */
  finding: string;
  /** The key the answer is about, so a later edit invalidates it. */
  key: string;
  vendor: ByoVendor;
  at: string;
}

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;
const CHECK_LATENCY = 900;

export const useSmsProvidersStore = defineStore("sms-providers", () => {
  const states = ref<Record<string, SendingState>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});
  /** The last answer the vendor gave, per project. Never a stored credential. */
  const checks = ref<Record<string, AccountCheck>>({});

  setTimeout(() => {
    states.value = {
      prj_personal: { mode: "managed", account: null },
      prj_acme: {
        mode: "byo",
        account: {
          vendor: "twilio",
          key: "AC7f3c1d90ab5e42d8b6104f27ce9a3b55",
          secretSet: true,
          secretUpdatedAt: "2026-08-02T11:15:00.000Z",
        },
      },
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function stateFor(projectId: string): SendingState {
    return states.value[projectId] ?? { mode: "managed", account: null };
  }

  function modeFor(projectId: string): SendingMode {
    return stateFor(projectId).mode;
  }

  function accountFor(projectId: string): ByoAccount | null {
    return stateFor(projectId).account;
  }

  function write(projectId: string, next: SendingState) {
    states.value = { ...states.value, [projectId]: next };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  async function setMode(projectId: string, mode: SendingMode): Promise<void> {
    const next = withMode(stateFor(projectId), mode);
    if (next === stateFor(projectId)) return;
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(projectId, next);
  }

  /**
   * The whole credential set as one write, because a vendor half saved fails at the
   * carrier rather than in the panel. A blank secret keeps the stored one: the panel
   * cannot read it back, so there is no way to tell "unchanged" from "cleared" other
   * than saying so, and clearing is what removing the account is for.
   */
  async function saveAccount(projectId: string, draft: ByoDraft): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const held = accountFor(projectId);
    const given = draft.secret.trim() !== "";
    /* A stored secret is kept only where the vendor has not changed under it: the two
       vendors' tokens are not interchangeable, so a switch with a blank field is a
       vendor with no secret rather than one that inherited the last vendor's. */
    const keeps = held !== null && held.vendor === draft.vendor && held.secretSet;
    write(
      projectId,
      afterAccountSaved({
        vendor: draft.vendor,
        key: draft.key.trim(),
        secretSet: given || keeps,
        secretUpdatedAt: given ? new Date().toISOString() : (held?.secretUpdatedAt ?? null),
      }),
    );
  }

  /**
   * Presents the credentials to the vendor and reports what it said.
   *
   * The placeholder refuses a secret too short to be one and accepts anything else; the
   * real call is a server-side request to the vendor's own account endpoint, which is why
   * the secret is sent here and never held. Nothing is written by a check: activating is
   * a separate act, so a refused credential set cannot switch delivery underneath a
   * project (notes/sms-providers.md acceptance checks).
   */
  async function verifyAccount(projectId: string, draft: ByoDraft): Promise<AccountCheck> {
    await new Promise((resolve) => setTimeout(resolve, CHECK_LATENCY));
    const vendor = byoVendorInfo(draft.vendor);
    const label = vendor?.label ?? draft.vendor;
    const secret = draft.secret.trim();
    const held = accountFor(projectId);
    const keeps = held !== null && held.vendor === draft.vendor && held.secretSet;
    const shaped = isByoKey(draft.vendor, draft.key);
    const answered = shaped && (secret.length >= 8 || (secret === "" && keeps));
    const check: AccountCheck = {
      ok: answered,
      finding: answered
        ? `${label} recognised the credentials and answered for the account.`
        : shaped
          ? `${label} refused the credentials. The ${vendor?.secretLabel.toLowerCase() ?? "secret"} is the half that is usually wrong, and it is the half we cannot show you.`
          : `${label} was not asked: that is not the shape of a ${vendor?.keyLabel.toLowerCase() ?? "key"}, so it would have been refused.`,
      key: draft.key.trim(),
      vendor: draft.vendor,
      at: new Date().toISOString(),
    };
    checks.value = { ...checks.value, [projectId]: check };
    return check;
  }

  function checkFor(projectId: string): AccountCheck | null {
    return checks.value[projectId] ?? null;
  }

  /** Hands the project back to our routing. Nothing stops sending. */
  async function removeAccount(projectId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(projectId, afterAccountRemoved());
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  /**
   * What the meter counted over the last thirty days.
   *
   * Nought everywhere while no vendor adapter is wired, which is every deployment today.
   * A figure here is a message somebody was handed, and drawing eighteen thousand of them
   * against a router that cannot dispatch is the claim `notes/sms-providers.md` P1 is
   * about: unfalsifiable from the panel, and only discovered on somebody's sign-in. The
   * fixtures stay behind the check so they come back with the adapter.
   */
  function traffic(projectId: string): SmsTraffic {
    if (!transportWired()) return NO_TRAFFIC;
    return projectId === "prj_acme" ? ACME_TRAFFIC : PERSONAL_TRAFFIC;
  }

  return {
    states,
    loading,
    stateFor,
    modeFor,
    accountFor,
    setMode,
    verifyAccount,
    checkFor,
    saveAccount,
    removeAccount,
    lastSavedAt,
    traffic,
  };
});

/*
 * The figures. Deterministic, so a reload does not redraw a different month.
 */

function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function daily(seed: number, base: number, swing: number): number[] {
  const next = seeded(seed);
  return Array.from({ length: 30 }, () => Math.max(0, Math.round(base + (next() - 0.5) * swing)));
}

/** Totals summed from the days behind them, so no tile can contradict another. */
function trafficFrom(
  sentDaily: number[],
  failureRate: number,
  spendPerMessage: number,
  byProvider: { id: SmsProviderId; share: number }[],
): SmsTraffic {
  const sent = sentDaily.reduce((total, day) => total + day, 0);
  const failed = Math.round(sent * failureRate);
  return {
    sent,
    sentDaily,
    delivered: sent - failed,
    failed,
    spend: Math.round(sent * spendPerMessage * 100) / 100,
    currency: "USD",
    byProvider: byProvider.map((entry) => ({
      id: entry.id,
      count: Math.round(sent * entry.share),
    })),
  };
}

/** Nothing carried, which is what a deployment with no adapter has to show. */
const NO_TRAFFIC: SmsTraffic = trafficFrom(daily(7, 0, 0), 0, 0, []);

const PERSONAL_TRAFFIC = trafficFrom(daily(7, 0, 0), 0, 0, []);

/* Acme brings its own Twilio, so the spend is its carrier's bill and not ours. */
const ACME_TRAFFIC = trafficFrom(daily(13, 620, 380), 0.021, 0, [{ id: "twilio", share: 1 }]);
