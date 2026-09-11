/**
 * The signed-in person's own account, as this panel holds it.
 *
 * Keyed on nobody: there is one signed-in person and switching project does not change who
 * that is, which is why this store takes no project id where every other one does. It is
 * also why the drawer puts the account at the foot and the project switcher at the head.
 *
 * Placeholder until the panel builds an SDK client, at which point the profile is the `user`
 * on `Session` from `@idenzy/js`, the factors come from `GET v1/auth/mfa/factors`, and the
 * sessions come from the same endpoint the sessions screen reads for everybody else.
 */

import {
  ACCOUNT_FACTORS,
  type AccountFactor,
  type AccountProfile,
  type AccountSession,
  type EmailChange,
  emailChangeExpiresAt,
} from "~/utils/account";
import { DURATIONS } from "~/utils/time";

const SAVE_LATENCY = 600;

export const useAccountStore = defineStore("account", () => {
  const profile = ref<AccountProfile>({
    userId: "usr_7cQm2xLp9Rt4Vn8Ka3Zs",
    name: "Hasan",
    email: "hasan@example.com",
    emailVerified: true,
    createdAt: new Date(Date.now() - 412 * DURATIONS.DAY).toISOString(),
    lastSignInAt: new Date(Date.now() - 3 * DURATIONS.MINUTE).toISOString(),
    passwordChangedAt: new Date(Date.now() - 190 * DURATIONS.DAY).toISOString(),
  });

  const factors = ref<AccountFactor[]>([
    {
      kind: "totp",
      enrolled: true,
      count: null,
      addedAt: new Date(Date.now() - 340 * DURATIONS.DAY).toISOString(),
      lastUsedAt: new Date(Date.now() - 3 * DURATIONS.MINUTE).toISOString(),
    },
    {
      kind: "passkey",
      enrolled: true,
      count: 2,
      addedAt: new Date(Date.now() - 96 * DURATIONS.DAY).toISOString(),
      lastUsedAt: new Date(Date.now() - 4 * DURATIONS.DAY).toISOString(),
    },
    {
      kind: "recovery",
      enrolled: true,
      count: 8,
      addedAt: new Date(Date.now() - 340 * DURATIONS.DAY).toISOString(),
      lastUsedAt: null,
    },
  ]);

  const sessions = ref<AccountSession[]>([
    {
      id: "ses_current",
      deviceName: "MacBook Pro",
      browser: "Chrome on macOS",
      ip: "81.42.19.204",
      country: "ES",
      createdAt: new Date(Date.now() - 2 * DURATIONS.DAY).toISOString(),
      lastActiveAt: new Date().toISOString(),
      current: true,
    },
    {
      id: "ses_phone",
      deviceName: "iPhone",
      browser: "Safari on iOS",
      ip: "81.42.19.204",
      country: "ES",
      createdAt: new Date(Date.now() - 9 * DURATIONS.DAY).toISOString(),
      lastActiveAt: new Date(Date.now() - 6 * DURATIONS.HOUR).toISOString(),
      current: false,
    },
    {
      id: "ses_desk",
      deviceName: "Office desktop",
      browser: "Firefox on Windows",
      ip: "194.11.62.9",
      country: "NL",
      createdAt: new Date(Date.now() - 41 * DURATIONS.DAY).toISOString(),
      lastActiveAt: new Date(Date.now() - 12 * DURATIONS.DAY).toISOString(),
      current: false,
    },
  ]);

  /** An address change that has been asked for and not finished. */
  const emailChange = ref<EmailChange | null>(null);

  const lastSaved = ref<string | null>(null);

  const loading = ref(true);
  const ready = new Promise<void>((resolve) => setTimeout(resolve, 350));
  void ready.then(() => {
    loading.value = false;
  });

  function stamp() {
    lastSaved.value = new Date().toISOString();
  }

  async function patch(change: Partial<AccountProfile>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    profile.value = { ...profile.value, ...change };
    stamp();
  }

  /**
   * Starts an address change and moves nothing.
   *
   * The live address stays the live address until both sides have confirmed, so this
   * writes a pending record beside the profile rather than over it. Writing the new one
   * straight onto the profile with `emailVerified: false` is what the note calls out: it
   * reads as a move that happened, on an account whose owner can still only reach the old
   * mailbox.
   */
  async function startEmailChange(email: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const requestedAt = new Date();
    emailChange.value = {
      email: email.trim().toLowerCase(),
      requestedAt: requestedAt.toISOString(),
      expiresAt: emailChangeExpiresAt(requestedAt),
      currentConfirmed: false,
      newConfirmed: false,
    };
    stamp();
  }

  /** Abandons it. The address on the account never moved, so there is nothing to undo. */
  async function cancelEmailChange(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    emailChange.value = null;
    stamp();
  }

  /**
   * Changes the password.
   *
   * Both halves land together on purpose: the write and the revocation of the other
   * sessions are one action to the person doing it, and a screen that reported the first
   * before the second would have somebody closing the tab mid-way.
   */
  async function changePassword(signOutOthers: boolean): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    profile.value = { ...profile.value, passwordChangedAt: new Date().toISOString() };
    if (signOutOthers) sessions.value = sessions.value.filter((session) => session.current);
    stamp();
  }

  /**
   * Removes a factor.
   *
   * Recovery codes go with the last factor that demanded a challenge, which is the server's
   * rule and not this screen's: ten single-use passwords must not outlive the thing they
   * were the fallback for.
   */
  async function removeFactor(kind: AccountFactor["kind"]): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const next = factors.value.map((factor) =>
      factor.kind === kind ? { ...factor, enrolled: false, count: null, lastUsedAt: null } : factor,
    );
    const demandsLeft = next.some((factor) => factor.enrolled && factor.kind === "totp");
    factors.value = demandsLeft
      ? next
      : next.map((factor) =>
          factor.kind === "recovery" ? { ...factor, enrolled: false, count: null } : factor,
        );
    stamp();
  }

  /** Ends one of your own dashboard sessions. The current one is refused, not hidden. */
  async function revokeSession(id: string): Promise<void> {
    const session = sessions.value.find((entry) => entry.id === id);
    if (session === undefined || session.current) return;
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    sessions.value = sessions.value.filter((entry) => entry.id !== id);
    stamp();
  }

  /** Everything but the one this page is being read in, which would be signing out. */
  async function signOutOthers(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    sessions.value = sessions.value.filter((session) => session.current);
    stamp();
  }

  const factorFor = (kind: AccountFactor["kind"]) =>
    factors.value.find((factor) => factor.kind === kind) ??
    ({
      kind,
      enrolled: false,
      count: null,
      addedAt: null,
      lastUsedAt: null,
    } satisfies AccountFactor);

  /** All three, always, in the order the screen lists them. */
  const allFactors = computed(() => ACCOUNT_FACTORS.map(factorFor));

  return {
    loading,
    profile,
    emailChange,
    factors: allFactors,
    sessions,
    lastSaved,
    patch,
    startEmailChange,
    cancelEmailChange,
    changePassword,
    removeFactor,
    revokeSession,
    signOutOthers,
  };
});
