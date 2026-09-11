/**
 * Each project's one-time code settings and the figures the screen shows beside them.
 *
 * The channel switches live in the project's `settings` on the server and the magic
 * link destinations are rows of `redirect_uris` under the `magic_link` kind, both read
 * and written through the management API; this store is those as the panel sees them,
 * with a placeholder until the client exists. A change is written the moment it is made
 * and the screen shows its own busy state, as the passwords screen does.
 *
 * A patch is merged a section at a time against what is saved when it lands, not when
 * it was sent: two switches on one channel flipped in quick succession would otherwise
 * have the second write carry the first one's old value back.
 */

import { DEFAULT_OTP_SETTINGS, type OtpSettings } from "~/utils/otp";

export type OtpSettingsChange = {
  [K in keyof OtpSettings]?: Partial<OtpSettings[K]>;
};

export interface OtpStats {
  /** Over the last thirty days, oldest day first. Sign-ins by a code or a link. */
  signIns: number;
  signInsDaily: number[];
  /** Codes sent, by email and SMS together. */
  codesSent: number;
  codesSentDaily: number[];
  linksSent: number;
  linksSentDaily: number[];
  /** Verifications refused: a wrong code, an expired challenge, the fifth attempt. */
  refused: number;
  refusedDaily: number[];
  /** Sends by what carried them. */
  byChannel: { email: number; sms: number; magicLink: number };
  /** SMS codes that were entered: the fraud guard's denominator (PROJECT.md 4.8). */
  smsVerified: number;
}

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const useOtpStore = defineStore("otp", () => {
  const settings = ref<Record<string, OtpSettings>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    settings.value = {
      prj_personal: {
        email: { enabled: true, allowSignUp: true },
        sms: { enabled: false, allowSignUp: true },
        magicLink: { enabled: false, allowSignUp: true, redirectUris: [] },
      },
      prj_acme: {
        email: { enabled: true, allowSignUp: true },
        sms: { enabled: true, allowSignUp: false },
        magicLink: {
          enabled: true,
          allowSignUp: true,
          redirectUris: [
            "https://app.acme.com/auth/callback",
            "https://staging.acme.com/auth/callback",
          ],
        },
      },
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function settingsFor(projectId: string): OtpSettings {
    return settings.value[projectId] ?? copy(DEFAULT_OTP_SETTINGS);
  }

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patch(projectId: string, change: OtpSettingsChange): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const current = settingsFor(projectId);
    settings.value = {
      ...settings.value,
      [projectId]: {
        email: { ...current.email, ...change.email },
        sms: { ...current.sms, ...change.sms },
        magicLink: {
          ...current.magicLink,
          ...change.magicLink,
          redirectUris: [...(change.magicLink?.redirectUris ?? current.magicLink.redirectUris)],
        },
      },
    };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  function stats(projectId: string): OtpStats {
    return projectId === "prj_acme" ? ACME_STATS : PERSONAL_STATS;
  }

  return { settings, loading, settingsFor, patch, lastSavedAt, stats };
});

function copy(settings: OtpSettings): OtpSettings {
  return {
    email: { ...settings.email },
    sms: { ...settings.sms },
    magicLink: { ...settings.magicLink, redirectUris: [...settings.magicLink.redirectUris] },
  };
}

/*
 * Placeholder figures, seeded so they hold still. The personal project sends a few
 * email codes; Acme runs all three channels and sees the SMS refusals a real project does.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daily(seed: number, base: number, swing: number): number[] {
  const random = seeded(seed);
  return Array.from({ length: 30 }, (_, day) => {
    const weekend = day % 7 === 5 || day % 7 === 6 ? 0.6 : 1;
    return Math.max(0, Math.round((base + (random() - 0.5) * swing) * weekend));
  });
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

const PERSONAL_CODES = daily(41, 38, 18);
const PERSONAL_SIGN_INS = PERSONAL_CODES.map((sent) => Math.round(sent * 0.86));
const PERSONAL_REFUSED = daily(43, 2, 3);

const PERSONAL_STATS: OtpStats = {
  signIns: sum(PERSONAL_SIGN_INS),
  signInsDaily: PERSONAL_SIGN_INS,
  codesSent: sum(PERSONAL_CODES),
  codesSentDaily: PERSONAL_CODES,
  linksSent: 0,
  linksSentDaily: [],
  refused: sum(PERSONAL_REFUSED),
  refusedDaily: PERSONAL_REFUSED,
  byChannel: { email: sum(PERSONAL_CODES), sms: 0, magicLink: 0 },
  smsVerified: 0,
};

const ACME_EMAIL = daily(47, 326, 120);
const ACME_SMS = daily(53, 46, 24);
const ACME_LINKS = daily(59, 21, 12);
const ACME_CODES = ACME_EMAIL.map((email, day) => email + (ACME_SMS[day] ?? 0));
const ACME_SIGN_INS = ACME_CODES.map(
  (codes, day) => Math.round(codes * 0.83) + Math.round((ACME_LINKS[day] ?? 0) * 0.71),
);
const ACME_REFUSED = daily(61, 19, 14);

const ACME_STATS: OtpStats = {
  signIns: sum(ACME_SIGN_INS),
  signInsDaily: ACME_SIGN_INS,
  codesSent: sum(ACME_CODES),
  codesSentDaily: ACME_CODES,
  linksSent: sum(ACME_LINKS),
  linksSentDaily: ACME_LINKS,
  refused: sum(ACME_REFUSED),
  refusedDaily: ACME_REFUSED,
  byChannel: { email: sum(ACME_EMAIL), sms: sum(ACME_SMS), magicLink: sum(ACME_LINKS) },
  smsVerified: Math.round(sum(ACME_SMS) * 0.87),
};
