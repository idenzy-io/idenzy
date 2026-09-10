/**
 * Each project's SMS policy and what it has spent today.
 *
 * Read by the one-time codes screen, which needs to know whether SMS can send at all, and
 * written by Policy & spend, which is the screen the row belongs to. One store for both,
 * so the two cannot disagree about the same row.
 *
 * `attestationWired` is not part of the policy and never will be. Whether an attestation
 * provider exists is the deployment's business rather than the project's, and the two are
 * kept apart because a project turning the requirement off is accepting the pumping risk
 * itself, which is a different decision from ours not having wired a verifier.
 *
 * A placeholder until the management client exists, like every store here.
 */

import { SMS_POLICY_DEFAULTS, type SmsPolicy } from "~/utils/sms-policy";

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const useSmsPolicyStore = defineStore("sms-policy", () => {
  /** Null is a project with no row, which is a project that sends nothing. */
  const policies = ref<Record<string, SmsPolicy | null>>({});
  /** Overrides the placeholder figure once something on this screen has moved it. */
  const spend = ref<Record<string, number>>({});
  const loading = ref(true);

  setTimeout(() => {
    policies.value = {
      prj_personal: null,
      prj_acme: {
        allowedCountries: ["US", "CA", "GB", "DE", "NL", "TR"],
        dailySpendCap: 25,
        currency: "USD",
        attestationRequired: true,
        perNumberDailyLimit: 5,
        perIpHourlyLimit: 10,
        maxSendsPerVerify: 6,
        senderId: "ACME",
      },
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function policyFor(projectId: string): SmsPolicy | null {
    return policies.value[projectId] ?? null;
  }

  /** Today's `usage_daily.sms_cost`, in the policy's currency. */
  function spentToday(projectId: string): number {
    const held = spend.value[projectId];
    if (held !== undefined) return held;
    return projectId === "prj_acme" ? 6.42 : 0;
  }

  /**
   * Today's row of `usage_daily`, which is what the cap is measured against and what the
   * verify ratio is read from. Sent and verified are the same counters the guard reads.
   */
  function countersToday(projectId: string): { sent: number; verified: number } {
    return projectId === "prj_acme" ? { sent: 918, verified: 604 } : { sent: 0, verified: 0 };
  }

  /**
   * Whether this deployment has an attestation provider that can answer.
   *
   * False everywhere today: what is wired stands in for one and answers false to
   * everything, so a project requiring attestation sends nothing at all. Held here rather
   * than on the policy because no project setting changes it.
   */
  const attestationWired = ref(false);

  const lastSaved = ref<Record<string, string>>({});

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patch(projectId: string, change: Partial<SmsPolicy>): Promise<void> {
    const current = policyFor(projectId);
    if (current === null) return;
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    policies.value = { ...policies.value, [projectId]: { ...current, ...change } };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  /**
   * Creates the row for a project that has none, with the column defaults.
   *
   * The allowlist is still empty afterwards and the project still sends nothing, which is
   * the honest result: creating a policy is not the same as deciding where to send, and a
   * screen that quietly allowed somewhere would be choosing a country on the customer's
   * behalf.
   */
  async function create(projectId: string): Promise<void> {
    if (policyFor(projectId) !== null) return;
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    policies.value = {
      ...policies.value,
      [projectId]: { ...SMS_POLICY_DEFAULTS, allowedCountries: [], senderId: null },
    };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return {
    policies,
    loading,
    policyFor,
    spentToday,
    countersToday,
    attestationWired,
    patch,
    create,
    lastSavedAt,
  };
});
