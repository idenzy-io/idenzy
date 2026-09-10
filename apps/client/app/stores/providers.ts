/**
 * Each project's social providers, its linking rule, and the figures the providers
 * screen shows beside them.
 *
 * A provider is a row of `oauth_providers`, one per project and provider, read and
 * written through the management API; the linking rule lives in the project's settings.
 * This store is both as the panel sees them, with a placeholder until that client
 * exists. A change is written the moment it is made, as on the passwords and passkeys
 * screens, and the client secret goes one way: the panel is told that one is stored and
 * when, never what it is.
 */

import {
  DEFAULT_PROVIDER_CONFIG,
  normaliseInstance,
  type ProviderConfig,
  type ProviderDraft,
  type ProviderName,
  parseScopes,
} from "~/utils/providers";

/** The one project-wide decision on this screen (PROJECT.md 4.6). */
export interface LinkingSettings {
  /**
   * Join a sign-in to an account holding the same address, where the provider asserts
   * the address is verified. Off, every match goes through an email code first.
   */
  autoLink: boolean;
}

export const DEFAULT_LINKING: LinkingSettings = { autoLink: true };

export interface ProviderStats {
  /** Over the last thirty days, oldest day first. */
  signIns: number;
  signInsDaily: number[];
  /** Accounts created by a social sign-in, rather than joined to an existing one. */
  newAccounts: number;
  newAccountsDaily: number[];
  /** Accounts holding at least one social identity. */
  linked: number;
  /** Sign-ins that matched an address nobody proved, answered `linking_requires_verification`. */
  refused: number;
  refusedDaily: number[];
  /** Sign-ins by provider over the same window. */
  byProvider: { id: ProviderName; count: number }[];
}

/** A project's providers, by name. Absent means never configured. */
export type ProviderConfigs = Partial<Record<ProviderName, ProviderConfig>>;

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const useProvidersStore = defineStore("providers", () => {
  const configs = ref<Record<string, ProviderConfigs>>({});
  const linking = ref<Record<string, LinkingSettings>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    configs.value = { prj_personal: PERSONAL_PROVIDERS, prj_acme: {} };
    linking.value = { prj_personal: { autoLink: true }, prj_acme: { autoLink: true } };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): ProviderConfigs {
    return configs.value[projectId] ?? {};
  }

  /** Null for a provider this project has never set up, which is not the same as off. */
  function configFor(projectId: string, id: ProviderName): ProviderConfig | null {
    return forProject(projectId)[id] ?? null;
  }

  /** Everything this project has set up, for the screen to put in the catalogue's order. */
  function configured(projectId: string): { id: ProviderName; config: ProviderConfig }[] {
    const project = forProject(projectId);
    const entries: { id: ProviderName; config: ProviderConfig }[] = [];
    for (const id of Object.keys(project) as ProviderName[]) {
      const config = project[id];
      if (config !== undefined) entries.push({ id, config });
    }
    return entries;
  }

  function linkingFor(projectId: string): LinkingSettings {
    return linking.value[projectId] ?? { ...DEFAULT_LINKING };
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function write(projectId: string, id: ProviderName, config: ProviderConfig) {
    configs.value = {
      ...configs.value,
      [projectId]: { ...forProject(projectId), [id]: config },
    };
    stamp(projectId);
  }

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patch(
    projectId: string,
    id: ProviderName,
    change: Partial<ProviderConfig>,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const current = configFor(projectId, id) ?? { ...DEFAULT_PROVIDER_CONFIG };
    write(projectId, id, { ...current, ...change });
  }

  /**
   * The whole credential set as one write, because the fields are validated together and
   * a provider half saved is a provider that fails at the token endpoint.
   *
   * A blank secret keeps the stored one. The panel cannot read it back, so there is no
   * way to distinguish "unchanged" from "cleared" other than saying so, and clearing is
   * what removing the provider is for.
   */
  async function save(projectId: string, id: ProviderName, draft: ProviderDraft): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const current = configFor(projectId, id) ?? { ...DEFAULT_PROVIDER_CONFIG };
    const secretGiven = draft.clientSecret.trim() !== "";
    const instant = draft.mode === "instant";

    write(projectId, id, {
      ...current,
      enabled: true,
      mode: draft.mode,
      clientId: instant ? "" : draft.clientId.trim(),
      secretSet: instant ? false : secretGiven || current.secretSet,
      secretUpdatedAt: secretGiven ? new Date().toISOString() : current.secretUpdatedAt,
      scopes: draft.customScopes ? parseScopes(draft.scopes) : [],
      settings: settingsOf(draft),
      storeTokens: draft.storeTokens,
    });
  }

  /**
   * Takes the provider off the project. The identities stay: nobody is deleted, and the
   * links come back if it is set up again. What goes is the credentials.
   */
  async function remove(projectId: string, id: ProviderName): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const project = { ...forProject(projectId) };
    delete project[id];
    configs.value = { ...configs.value, [projectId]: project };
    stamp(projectId);
  }

  async function setLinking(projectId: string, change: Partial<LinkingSettings>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    linking.value = {
      ...linking.value,
      [projectId]: { ...linkingFor(projectId), ...change },
    };
    stamp(projectId);
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  function stats(projectId: string): ProviderStats {
    return projectId === "prj_acme" ? ACME_STATS : PERSONAL_STATS;
  }

  /** Accounts whose only way in is this provider, which is what turning it off costs. */
  function strandedBy(projectId: string, id: ProviderName): number {
    const only: Partial<Record<ProviderName, number>> =
      projectId === "prj_acme" ? {} : PERSONAL_ONLY;
    return only[id] ?? 0;
  }

  return {
    configs,
    linking,
    loading,
    forProject,
    configFor,
    configured,
    linkingFor,
    patch,
    save,
    remove,
    setLinking,
    lastSavedAt,
    stats,
    strandedBy,
  };
});

/**
 * The extras as the row carries them. A field left blank is a field the row does not
 * hold, so the server falls back to the provider's own default rather than reading an
 * empty string as a value.
 */
function settingsOf(draft: ProviderDraft): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft.settings)) {
    const written = key === "instance" ? normaliseInstance(value) : value.trim();
    if (written !== "") settings[key] = written;
  }
  return settings;
}

/*
 * The placeholder project. Google and GitHub on their own credentials, Apple half set
 * up and switched off, Discord on our shared app because somebody is trying it locally.
 */
const PERSONAL_PROVIDERS: ProviderConfigs = {
  google: {
    enabled: true,
    mode: "custom",
    clientId: "418923771044-h2q9vv1n8f0m3s7k.apps.googleusercontent.com",
    secretSet: true,
    secretUpdatedAt: "2026-07-14T09:12:00.000Z",
    scopes: [],
    settings: {},
    storeTokens: false,
  },
  github: {
    enabled: true,
    mode: "custom",
    clientId: "Iv1.8f3c2a91d4e75b60",
    secretSet: true,
    secretUpdatedAt: "2026-08-02T16:40:00.000Z",
    scopes: ["read:user", "user:email"],
    settings: {},
    storeTokens: true,
  },
  apple: {
    enabled: false,
    mode: "custom",
    clientId: "com.example.web",
    secretSet: true,
    secretUpdatedAt: "2026-08-28T11:05:00.000Z",
    scopes: [],
    settings: { teamId: "9QJ4TZ2P8L", keyId: "K7D2M4XR9V" },
    storeTokens: false,
  },
  discord: {
    enabled: true,
    mode: "instant",
    clientId: "",
    secretSet: false,
    secretUpdatedAt: null,
    scopes: [],
    settings: {},
    storeTokens: false,
  },
};

/** Accounts on the placeholder project whose only sign-in is that provider. */
const PERSONAL_ONLY: Partial<Record<ProviderName, number>> = {
  google: 312,
  github: 87,
  apple: 0,
  discord: 4,
};

/*
 * Placeholder figures, seeded so they hold still.
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

const PERSONAL_SIGN_INS = daily(31, 74, 34);
const PERSONAL_NEW = daily(33, 5.5, 6);
const PERSONAL_REFUSED = daily(35, 0.7, 2);

const PERSONAL_STATS: ProviderStats = {
  signIns: sum(PERSONAL_SIGN_INS),
  signInsDaily: PERSONAL_SIGN_INS,
  newAccounts: sum(PERSONAL_NEW),
  newAccountsDaily: PERSONAL_NEW,
  linked: 468,
  refused: sum(PERSONAL_REFUSED),
  refusedDaily: PERSONAL_REFUSED,
  byProvider: [
    { id: "google", count: 1284 },
    { id: "github", count: 486 },
    { id: "discord", count: 61 },
  ],
};

const ZEROES = Array.from({ length: 30 }, () => 0);

const ACME_STATS: ProviderStats = {
  signIns: 0,
  signInsDaily: ZEROES,
  newAccounts: 0,
  newAccountsDaily: ZEROES,
  linked: 0,
  refused: 0,
  refusedDaily: ZEROES,
  byProvider: [],
};
