/**
 * Each project's API keys, and what can be done to them: make one, start a rotation on one,
 * and revoke one.
 *
 * The store never holds a plaintext key. `create` and `rotate` return one and forget it in
 * the same breath, exactly as the server does: the row carries a digest, and the value
 * exists only in the reply. Keeping it here so the screen could show it twice would rebuild,
 * in a Pinia store, the retrievable-key design the schema went out of its way to avoid.
 *
 * `createdBy` is who the audit trail's `key.created` entry names, and `replaces` is the
 * proposed column that makes a rotation explicit. Both model what the management API will
 * answer with, like every placeholder in the panel; neither is a label kept only here.
 *
 * The rows are seeded off the project id so a key holds still between visits. Keys made and
 * revoked this session are kept beside the derivation, so an action survives a project
 * switch and back.
 */

import {
  type ApiKeyKind,
  isLive,
  KEY_FORMAT,
  KEY_KIND_PREFIXES,
  type ProjectApiKey,
} from "~/utils/keys";
import { DURATIONS } from "~/utils/time";

const WORK_LATENCY = 700;

export const useKeysStore = defineStore("keys", () => {
  const account = useAccountStore();

  /** Rows the operator made this session, by project. They carry no plaintext either. */
  const made = ref<Record<string, ProjectApiKey[]>>({});
  /** Ids revoked this session, and when, by project. */
  const revoked = ref<Record<string, Record<string, string>>>({});

  const loading = ref(true);
  setTimeout(() => {
    loading.value = false;
  }, 400);

  /** Every key on the project, newest first. */
  function keysFor(projectId: string): ProjectApiKey[] {
    const extra = made.value[projectId] ?? [];
    const gone = revoked.value[projectId] ?? {};
    return [...placeholderKeys(projectId), ...extra]
      .map((key) => {
        const at = gone[key.id];
        return at === undefined ? key : { ...key, revokedAt: at };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function issue(
    projectId: string,
    kind: ApiKeyKind,
    replaces: string | null,
  ): Promise<{ key: ProjectApiKey; secret: string }> {
    await new Promise((resolve) => setTimeout(resolve, WORK_LATENCY));
    const secret = `${KEY_KIND_PREFIXES[kind]}${randomBody()}`;
    const key: ProjectApiKey = {
      id: `key_${randomBody().slice(0, 16)}`,
      kind,
      prefix: secret.slice(0, KEY_FORMAT.prefixLength),
      scopes: [],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      createdBy: account.profile.name,
      replaces,
    };
    made.value = { ...made.value, [projectId]: [...(made.value[projectId] ?? []), key] };
    return { key, secret };
  }

  /**
   * Issues a key and hands back the only copy of it. A second live key of a kind is just a
   * second key: nothing here marks either of them as replacing the other.
   */
  function create(projectId: string, kind: ApiKeyKind) {
    return issue(projectId, kind, null);
  }

  /**
   * Starts a rotation: a key of the same kind that names the one it replaces. The old key is
   * untouched and keeps working, which is the whole point; it goes when somebody revokes it.
   */
  function rotate(projectId: string, old: ProjectApiKey) {
    return issue(projectId, old.kind, old.id);
  }

  /**
   * Takes a key out of service. Immediate and total: the resolution function filters on
   * `revoked_at` with no cache in front of it, so the next request carrying this key is
   * refused rather than the one after some expiry.
   */
  async function revoke(projectId: string, keyId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, WORK_LATENCY));
    const held = revoked.value[projectId] ?? {};
    revoked.value = {
      ...revoked.value,
      [projectId]: { ...held, [keyId]: new Date().toISOString() },
    };
  }

  /** Live keys of each kind, for the create dialog's "this does not replace" line. */
  function liveOf(projectId: string): Record<ApiKeyKind, ProjectApiKey[]> {
    const live = keysFor(projectId).filter(isLive);
    return {
      publishable: live.filter((key) => key.kind === "publishable"),
      secret: live.filter((key) => key.kind === "secret"),
    };
  }

  return { loading, keysFor, create, rotate, revoke, liveOf };
});

/*
 * Key material for the placeholder.
 */

const BODY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * 32 bytes as base64url is 43 characters, which is what `generateOpaqueToken` returns and
 * therefore the width a real key has. Drawn one character per random byte rather than by
 * encoding, because the point is the shape rather than the bytes underneath it.
 */
const BODY_LENGTH = 43;

function randomBody(): string {
  const bytes = new Uint8Array(BODY_LENGTH);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += BODY_ALPHABET[byte % BODY_ALPHABET.length] ?? "A";
  return text;
}

/** The same shape, from a seed, so a placeholder key holds still between visits. */
function seededBody(random: () => number): string {
  let text = "";
  for (let index = 0; index < BODY_LENGTH; index += 1) {
    text += BODY_ALPHABET[Math.floor(random() * BODY_ALPHABET.length)] ?? "A";
  }
  return text;
}

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

function seedOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

interface Seed {
  kind: ApiKeyKind;
  createdDaysAgo: number;
  /** Minutes since it was last presented, or null for never. */
  usedMinutesAgo: number | null;
  revokedDaysAgo?: number;
  /** Null where the `key.created` entry is older than the audit trail keeps (a year). */
  createdBy: string | null;
  /** Index of the key in the same list this one replaces. */
  replaces?: number;
}

/**
 * Shaped like projects that have been running a while. The personal one has a second live
 * secret key that nobody has used and nothing names as a replacement: two keys, not a
 * rotation, which is exactly the case the old screen misread (notes/keys.md P1). Acme is in
 * two rotations somebody started: a secret key whose replacement is deployed while the old
 * one is still being presented, and a publishable key whose replacement has not been
 * deployed at all, which the page must never call finished.
 */
const SEEDS: Record<string, readonly Seed[]> = {
  prj_personal: [
    { kind: "publishable", createdDaysAgo: 402, usedMinutesAgo: 3, createdBy: null },
    {
      kind: "secret",
      createdDaysAgo: 402,
      usedMinutesAgo: 96 * 24 * 60,
      revokedDaysAgo: 96,
      createdBy: null,
    },
    { kind: "secret", createdDaysAgo: 97, usedMinutesAgo: 2, createdBy: "Ana Rodríguez" },
    { kind: "secret", createdDaysAgo: 2, usedMinutesAgo: null, createdBy: "Pieter de Vries" },
  ],
  prj_acme: [
    { kind: "publishable", createdDaysAgo: 380, usedMinutesAgo: 1, createdBy: null },
    {
      kind: "secret",
      createdDaysAgo: 400,
      usedMinutesAgo: 311 * 24 * 60,
      revokedDaysAgo: 310,
      createdBy: null,
    },
    { kind: "secret", createdDaysAgo: 310, usedMinutesAgo: 40, createdBy: "Ana Rodríguez" },
    { kind: "secret", createdDaysAgo: 3, usedMinutesAgo: 5, createdBy: "Mei Tanaka", replaces: 2 },
    {
      kind: "publishable",
      createdDaysAgo: 1,
      usedMinutesAgo: null,
      createdBy: "Mei Tanaka",
      replaces: 0,
    },
  ],
};

function placeholderKeys(projectId: string): ProjectApiKey[] {
  const random = seeded(seedOf(projectId));
  const now = Date.now();
  const seeds = SEEDS[projectId] ?? [];

  const keys = seeds.map((seed): ProjectApiKey => {
    const body = seededBody(random);
    return {
      id: `key_${body.slice(0, 16)}`,
      kind: seed.kind,
      prefix: `${KEY_KIND_PREFIXES[seed.kind]}${body}`.slice(0, KEY_FORMAT.prefixLength),
      scopes: [],
      createdAt: new Date(now - seed.createdDaysAgo * DURATIONS.DAY).toISOString(),
      lastUsedAt:
        seed.usedMinutesAgo === null
          ? null
          : new Date(now - seed.usedMinutesAgo * DURATIONS.MINUTE).toISOString(),
      revokedAt:
        seed.revokedDaysAgo === undefined
          ? null
          : new Date(now - seed.revokedDaysAgo * DURATIONS.DAY).toISOString(),
      createdBy: seed.createdBy,
      replaces: null,
    };
  });

  return keys.map((key, index) => {
    const target = seeds[index]?.replaces;
    return target === undefined ? key : { ...key, replaces: keys[target]?.id ?? null };
  });
}
