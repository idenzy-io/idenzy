/**
 * API keys as the server issues and checks them (`api_keys`, PROJECT.md 12), and what the
 * screen works out from them (notes/keys.md).
 *
 * Only a SHA-256 digest is stored, so a key is shown once, when it is made, and `prefix` is
 * the only part of it that exists in the clear. `revoked_at` is read on the request path
 * with no cache in front of it, so revoking lands on the next request, and replacing a key
 * without downtime is a procedure: a second key, a deployment, then the revocation.
 *
 * What the procedure never does is guess. Two live keys of one kind are two keys and not a
 * rotation: a rotation exists only when somebody starts one on a key, and the replacement
 * names the key it replaces. `last_used_at` is an observation rather than a census. It says
 * when a key was last presented and nothing about who else holds it, so the screen says "no
 * observed use" over a stated window and asks the operator to confirm their consumers. It
 * never says a key is safe to remove.
 *
 * The kinds are written out rather than imported from `@idenzy/protocol`, for the reason
 * `sessions.ts` writes out `AuthMethod`: the panel takes no dependency on that package until
 * the management API client does, and then both come from the one place.
 */

import { DURATIONS, relativeTimeWords } from "./time";

/*
 * The two kinds.
 */

export type ApiKeyKind = "publishable" | "secret";

/** Publishable first, because it is the one a project needs before anything works. */
export const API_KEY_KINDS: readonly ApiKeyKind[] = ["publishable", "secret"];

export const KEY_KIND_LABELS: Record<ApiKeyKind, string> = {
  publishable: "Publishable key",
  secret: "Secret key",
};

/** Written out in full so @nuxt/icon bundles them. */
export const KEY_KIND_ICONS: Record<ApiKeyKind, string> = {
  publishable: "material-symbols:public",
  secret: "material-symbols:lock-outline",
};

/**
 * The prefix each kind is issued under. Part of the wire contract in
 * `@idenzy/protocol/schemas/common`, so changing one is a breaking change for every
 * customer matching on it.
 */
export const KEY_KIND_PREFIXES: Record<ApiKeyKind, string> = {
  publishable: "pk_",
  secret: "sk_",
};

/** How a key of each kind reaches us. */
export const KEY_KIND_CARRIERS: Record<ApiKeyKind, string> = {
  publishable: "x-idenzy-publishable-key",
  secret: "Authorization: Bearer",
};

/** The choice the create dialog offers, in the reader's words rather than ours. */
export const KEY_USES: Record<ApiKeyKind, { label: string; description: string }> = {
  publishable: {
    label: "Browser or app",
    description:
      "Goes in code anybody can read: a web bundle, a mobile app, a game client. It names your project and authorises nothing on its own, so shipping it is the point.",
  },
  secret: {
    label: "Server",
    description:
      "Stays on your backend and acts as the project on the management API. It must never reach a browser, an app binary or a repository: a bundle publishes it at build time, and nothing unpublishes it afterwards.",
  },
};

/*
 * How a key is made and kept.
 */

export const KEY_FORMAT = {
  /** `generateOpaqueToken` in `@idenzy/crypto/tokens/random`, from node's CSPRNG. */
  bytes: 32,
  bits: 256,
  encoding: "base64url",
  digest: "SHA-256",
  /**
   * Characters of the random body kept in the clear, on top of the kind prefix and the cell.
   *
   * A key is `pk_<cell>_<body>`, so the stored display prefix is that head plus this many
   * characters of randomness — `pk_us1_3f9a2b8c`. Enough to pick a row out of a log or an
   * `.env`, far too few to be worth guessing the rest of. This used to be a count of the whole
   * key, which stopped meaning the same thing once the cell moved into the middle of it.
   */
  bodyPrefixLength: 8,
} as const;

/** The environment variables the CLI writes, and the one it will not. */
export const ENV_NAMES = {
  /** Under whatever prefix the framework exposes to a browser: `VITE_`, `NEXT_PUBLIC_`. */
  publishable: "IDENZY_PUBLISHABLE_KEY",
  apiUrl: "IDENZY_API_URL",
  /** Server runtime config only. There is deliberately no public spelling of this one. */
  secret: "IDENZY_SECRET_KEY",
} as const;

/*
 * A key as the panel sees it.
 */

export interface ProjectApiKey {
  /** The row's own id, which is what an audit entry names as the actor. */
  id: string;
  kind: ApiKeyKind;
  /** The head — kind prefix and cell — plus `KEY_FORMAT.bodyPrefixLength` of the body. */
  prefix: string;
  /** Nothing reads these yet, and the screen says so rather than offering them. */
  scopes: readonly string[];
  createdAt: string;
  /** Null until something presents it. An observation, never proof of who holds it. */
  lastUsedAt: string | null;
  revokedAt: string | null;
  /**
   * Who made it, read off the audit trail's `key.created` entry, since the row has no column
   * for it. Null once that entry is past retention.
   */
  createdBy: string | null;
  /**
   * The key this one was made to replace, set only by Rotate. Proposed: `api_keys` has no
   * column for it yet, which is why a rotation is not inferred from anything else.
   */
  replaces: string | null;
}

/**
 * Said once on the screen rather than faked on every row: the row has no column for a name,
 * and a label kept only in the panel would be a decoration that disagreed with every other
 * client of the API (notes/keys.md P1).
 */
export const PURPOSE_FIELD =
  "Purpose is a proposed field. The API keeps no name for a key yet, so a key is told apart by its prefix and by who made it.";

export function isLive(key: ProjectApiKey): boolean {
  return key.revokedAt === null;
}

/*
 * The tabs under the title.
 */

export type KeyTab = "all" | ApiKeyKind | "revoked";

/** All keys first, so the page's own address is the whole list and each tab narrows it. */
export const KEY_TABS: readonly { id: KeyTab; label: string }[] = [
  { id: "all", label: "All keys" },
  { id: "publishable", label: "Publishable keys" },
  { id: "secret", label: "Secret keys" },
  { id: "revoked", label: "Revoked" },
];

/** Anything the URL carries that is not a tab reads as the first one. */
export function keyTabOf(value: unknown): KeyTab {
  return KEY_TABS.some((tab) => tab.id === value) ? (value as KeyTab) : "all";
}

/**
 * What a tab lists, newest first. A revoked key is a record rather than something to act on,
 * so it has a tab of its own and joins the others only when the reader asks for it with Show
 * revoked.
 */
export function keysOnTab(
  keys: readonly ProjectApiKey[],
  tab: KeyTab,
  showRevoked = false,
): ProjectApiKey[] {
  const shown = keys.filter((key) => {
    if (tab === "revoked") return !isLive(key);
    if (!isLive(key) && !showRevoked) return false;
    return tab === "all" || key.kind === tab;
  });
  return shown.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Each tab's count as it would list, so a count never disagrees with the rows under it. */
export function tabCounts(
  keys: readonly ProjectApiKey[],
  showRevoked = false,
): Record<KeyTab, number> {
  return {
    all: keysOnTab(keys, "all", showRevoked).length,
    publishable: keysOnTab(keys, "publishable", showRevoked).length,
    secret: keysOnTab(keys, "secret", showRevoked).length,
    revoked: keysOnTab(keys, "revoked").length,
  };
}

/*
 * What was observed.
 */

/** How far back "no observed use" looks, stated wherever the words appear. */
export const OBSERVATION_WINDOW_HOURS = 24;

export const OBSERVATION_LIMIT =
  "Observed use is the last time a request presented the key. It says nothing about what presented it or how often, so a job that runs once a week looks unused for six days at a time.";

export type Observation = "recent" | "quiet" | "never";

export function observationOf(key: ProjectApiKey, now: Date): Observation {
  if (key.lastUsedAt === null) return "never";
  const since = now.getTime() - Date.parse(key.lastUsedAt);
  return since <= OBSERVATION_WINDOW_HOURS * DURATIONS.HOUR ? "recent" : "quiet";
}

/** What was seen, over what window. Never a verdict on whether anything still holds it. */
export function observationWords(key: ProjectApiKey, now: Date): string {
  const seen = observationOf(key, now);
  if (seen === "never" || key.lastUsedAt === null) return "Not observed";
  if (seen === "recent") return `Observed ${relativeTimeWords(key.lastUsedAt, now)}`;
  return `No observed use in ${OBSERVATION_WINDOW_HOURS} hours`;
}

/*
 * Rotating, only when somebody started it.
 */

export type RotationStep = "old" | "replacement" | "evidence" | "revoke";

export const ROTATION_STEPS: readonly { id: RotationStep; label: string }[] = [
  { id: "old", label: "Old key" },
  { id: "replacement", label: "Replacement" },
  { id: "evidence", label: "Deployment evidence" },
  { id: "revoke", label: "Revoke old" },
];

export interface Rotation {
  kind: ApiKeyKind;
  old: ProjectApiKey;
  replacement: ProjectApiKey;
  /** Something has presented the replacement, so it is deployed somewhere. */
  replacementObserved: boolean;
  /** The old key was presented after the replacement was made: something still holds it. */
  oldObservedSince: boolean;
  /** Where it stands. Revoking the old key ends the rotation, so there is no finished step. */
  step: RotationStep;
}

/**
 * Every rotation somebody started and has not finished: a live replacement naming a live old
 * key. Two live keys of one kind are not one, whatever their dates say, because the newer of
 * two keys is as likely to be an undeployed replacement as a key that already took over
 * (notes/keys.md P1). Revoking the replacement abandons the rotation, which is why it needs
 * both halves live.
 */
export function rotationsOf(keys: readonly ProjectApiKey[]): Rotation[] {
  const byId = new Map(keys.map((key) => [key.id, key]));
  const rotations: Rotation[] = [];
  for (const replacement of keys) {
    if (!isLive(replacement) || replacement.replaces === null) continue;
    const old = byId.get(replacement.replaces);
    if (old === undefined || !isLive(old)) continue;
    const made = Date.parse(replacement.createdAt);
    const replacementObserved = replacement.lastUsedAt !== null;
    rotations.push({
      kind: old.kind,
      old,
      replacement,
      replacementObserved,
      oldObservedSince: old.lastUsedAt !== null && Date.parse(old.lastUsedAt) > made,
      step: replacementObserved ? "revoke" : "evidence",
    });
  }
  return rotations;
}

/** Which half of a rotation a key is, for its row. */
export function rotationRole(
  key: ProjectApiKey,
  rotations: readonly Rotation[],
): { role: "old" | "replacement"; rotation: Rotation } | null {
  for (const rotation of rotations) {
    if (rotation.old.id === key.id) return { role: "old", rotation };
    if (rotation.replacement.id === key.id) return { role: "replacement", rotation };
  }
  return null;
}

/** What the workflow leads with. States what was observed and never that revoking is safe. */
export function rotationHeadline(rotation: Rotation): string {
  if (!rotation.replacementObserved) return "Deploy the replacement";
  if (rotation.oldObservedSince) return "Both keys are still in use";
  return "No observed use of the old key since the replacement was made";
}

export function rotationEvidence(
  rotation: Rotation,
  now: Date,
): { old: string; replacement: string } {
  const { old, replacement } = rotation;
  const replacementWords =
    replacement.lastUsedAt === null
      ? "Not observed yet. Until something presents it, nothing is using it, and the rotation is not finished."
      : `Observed ${relativeTimeWords(replacement.lastUsedAt, now)}, so something is deployed with it.`;

  let oldWords = "Not observed since it was made.";
  if (old.lastUsedAt !== null) {
    const last = relativeTimeWords(old.lastUsedAt, now);
    oldWords = rotation.oldObservedSince
      ? `Observed ${last}, after the replacement was made. Something still holds it.`
      : `No observed use since the replacement was made. Last observed ${last}.`;
  }
  return { old: oldWords, replacement: replacementWords };
}

/**
 * The instructions somebody pastes into a ticket or a deploy checklist. The value is not in
 * them because the panel does not hold it: it was shown once, to whoever made it.
 */
export function rotationInstructions(rotation: Rotation, projectName: string): string {
  const { old, replacement, kind } = rotation;
  const names = PLACEMENTS[kind].map((placement) => placement.name).join(" or ");
  const lines = [
    `Rotating the ${KEY_KIND_LABELS[kind].toLowerCase()} for ${projectName}.`,
    "",
    `1. Wherever ${old.prefix}… is set (${names}), put the replacement ${replacement.prefix}… in its place. Its value was shown once, when it was made; if nobody stored it, revoke ${replacement.prefix}… and start the rotation again.`,
    "2. Deploy every consumer, including scheduled jobs and anything that runs less often than daily.",
    `3. On the API keys screen, check the replacement shows observed use and the old key shows none after the replacement was made. ${OBSERVATION_LIMIT}`,
    `4. Revoke ${old.prefix}… from its menu. It is refused on the very next request; there is no grace period.`,
  ];
  if (kind === "secret") {
    lines.push("", `Server-side only: ${ENV_NAMES.secret} has no public spelling on purpose.`);
  }
  return lines.join("\n");
}

/*
 * Where a key goes.
 */

export interface Placement {
  id: string;
  label: string;
  /** The variable, under the framework's own prefix for a browser one. */
  name: string;
  /** The file or runtime that holds it. */
  where: string;
}

/** The prefixes a framework exposes to a browser. A secret key is never under one. */
export const PUBLIC_PREFIXES = ["VITE_", "NEXT_PUBLIC_", "NUXT_PUBLIC_", "PUBLIC_"] as const;

/**
 * The names our own starter templates write, so a line copied here and a line `idenzy init`
 * wrote agree (`examples/`). The browser list carries no secret on purpose, and a test holds
 * it to that.
 */
export const PLACEMENTS: Record<ApiKeyKind, readonly Placement[]> = {
  publishable: [
    {
      id: "vite",
      label: "React, Vue or Solid on Vite",
      name: "VITE_IDENZY_PUBLISHABLE_KEY",
      where: ".env",
    },
    {
      id: "next",
      label: "Next.js",
      name: "NEXT_PUBLIC_IDENZY_PUBLISHABLE_KEY",
      where: ".env.local",
    },
    { id: "nuxt", label: "Nuxt", name: "NUXT_PUBLIC_IDENZY_PUBLISHABLE_KEY", where: ".env" },
    { id: "sveltekit", label: "SvelteKit", name: "PUBLIC_IDENZY_PUBLISHABLE_KEY", where: ".env" },
  ],
  secret: [
    {
      id: "server",
      label: "Node, Next.js, SvelteKit, Remix or Astro server",
      name: "IDENZY_SECRET_KEY",
      where: "Server environment",
    },
    { id: "nuxt", label: "Nuxt", name: "NUXT_IDENZY_SECRET_KEY", where: "Server runtime config" },
  ],
};

/*
 * Writing one down.
 */

/** The dots that stand for the part of a key nobody will see again. */
export const KEY_MASK = "•".repeat(10);

/** What the panel can show of a key it does not hold: the prefix, then the mask. */
export function maskedKey(key: ProjectApiKey): string {
  return `${key.prefix}${KEY_MASK}`;
}

/** The key as the middle of a sentence names it: "secret key sk_us1_4fQ2x9a…". */
export function keyName(key: ProjectApiKey): string {
  return `${KEY_KIND_LABELS[key.kind].toLowerCase()} ${key.prefix}…`;
}

/**
 * What is true of scopes today, in one place. The column exists, the resolver returns it and
 * nothing reads it, so the create dialog offers no picker (notes/keys.md: "scope only if
 * enforced") and the screen says "full access" instead.
 */
export const SCOPES = {
  label: "Full access",
  note: "Every secret key can do everything the management API offers. The column that would narrow it exists on the row and no guard reads it yet, so a picker would describe a restriction nothing applies.",
} as const;
