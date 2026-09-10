/**
 * The published revocation set, as the panel shows it (PROJECT.md 4.2, ADR-0009).
 *
 * The set is what lets a five-minute access token behave like a sixty-second one without
 * a refresh storm. A customer's verifier is offline on purpose, so it polls a signed
 * snapshot and checks an in-process copy: a revocation check on their request path is a
 * hash lookup and no network call. Nothing here is a setting. The one number that shapes
 * the set is the access-token lifetime, and the lifetimes screen owns it, so the
 * retention is read from `./lifetimes` rather than written again here.
 *
 * Three entry shapes because one cannot carry all three cases, and the difference is not
 * cosmetic: a session id ends one session, a user watermark ends everything an account
 * held before an instant, and writing one entry per session instead would not bound a
 * user with forty devices.
 */

import { snapshotRetentionSeconds } from "./lifetimes";
import type { RevokeReason } from "./sessions";

/** How the set names what it ended. A project watermark has no id to carry. */
export type RevocationKind = "session" | "user" | "project";

export interface RevocationEntry {
  /** The public id a token carries: `ses_` for a session, `usr_` for a user. */
  id: string;
  kind: RevocationKind;
  /**
   * The instant of the revocation, which is what the entry is keyed by rather than the
   * instant it was written. That is what makes a replay free: the reconciler lands on the
   * entry it already wrote, and it still ages out on schedule.
   */
  revokedAt: string;
  /** What wrote it. Null for an entry replayed from the outbox with nothing to say. */
  reason: RevokeReason | null;
  /** The account it belongs to, so a row names a person rather than only an id. */
  userId: string;
}

export const REVOCATION_KIND_LABELS: Record<RevocationKind, string> = {
  session: "One session",
  user: "Every session the account held",
  project: "Every session in the project",
};

/**
 * How a token is judged against each shape, in the words the SDK compares in. The user
 * and project entries are watermarks: a token dies where its `iat` is strictly below the
 * instant, which is why one entry covers any number of sessions.
 */
export const REVOCATION_KIND_RULES: Record<RevocationKind, string> = {
  session: "Matched on the token's sid.",
  user: "Matched on the token's sub, against its iat.",
  project: "Matched on every token for the project, against its iat.",
};

/**
 * Which shape a reason writes, or null for one that writes nothing.
 *
 * A lapse is the null case and it is not an oversight. The idle clock only moves on a
 * rotation, so a session that goes idle stopped holding a live token long before it
 * lapsed, and there is nothing for an entry to kill.
 */
export function entryKindFor(reason: RevokeReason): RevocationKind | null {
  switch (reason) {
    case "signed_out":
    case "admin_revoked":
    case "refresh_token_reuse":
      return "session";
    case "signed_out_everywhere":
    case "password_changed":
    case "user_deleted":
      return "user";
    case "idle_timeout":
    case "absolute_timeout":
      return null;
  }
}

/** Every reason that reaches the set, in the order the breakdown lists them. */
export const PUBLISHING_REASONS: readonly RevokeReason[] = [
  "signed_out",
  "signed_out_everywhere",
  "password_changed",
  "admin_revoked",
  "refresh_token_reuse",
  "user_deleted",
];

/*
 * Ageing out. Retention is one access-token lifetime plus the skew, and no longer: a
 * token minted immediately before a revocation expires one lifetime later, so nothing
 * older can still be presented. That bound is the only reason the set is small enough to
 * publish whole rather than as a feed of changes.
 */

/** When an entry stops being published, given the project's access-token lifetime. */
export function agesOutAt(entry: RevocationEntry, accessTokenSeconds: number): Date {
  const at = new Date(entry.revokedAt).getTime();
  return new Date(at + snapshotRetentionSeconds(accessTokenSeconds) * 1000);
}

/** Seconds an entry has left, floored at zero. */
export function secondsLeft(entry: RevocationEntry, now: Date, accessTokenSeconds: number): number {
  const left = (agesOutAt(entry, accessTokenSeconds).getTime() - now.getTime()) / 1000;
  return Math.max(0, Math.floor(left));
}

/** How much of its window an entry has left, 0 to 1, for the meter beside it. */
export function remainingShare(
  entry: RevocationEntry,
  now: Date,
  accessTokenSeconds: number,
): number {
  const window = snapshotRetentionSeconds(accessTokenSeconds);
  if (window <= 0) return 0;
  return Math.min(1, secondsLeft(entry, now, accessTokenSeconds) / window);
}

/** Whether the snapshot still carries it. An entry past its window answers no. */
export function isPublished(
  entry: RevocationEntry,
  now: Date,
  accessTokenSeconds: number,
): boolean {
  return secondsLeft(entry, now, accessTokenSeconds) > 0;
}

/**
 * The set as the endpoint would serve it: watermarks collapsed to one entry per account,
 * sessions listed by id. Ordered newest first, because a reader scanning the list wants
 * what just happened.
 */
export function publishedEntries(
  entries: readonly RevocationEntry[],
  now: Date,
  accessTokenSeconds: number,
): RevocationEntry[] {
  return entries
    .filter((entry) => isPublished(entry, now, accessTokenSeconds))
    .sort((a, b) => b.revokedAt.localeCompare(a.revokedAt));
}

/*
 * What the endpoint is, fixed for the deployment.
 */

export const SNAPSHOT_PATH = "/v1/revocations";
export const SNAPSHOT_TYP = "idenzy-revocations+jwt";
/** `SNAPSHOT_TTL_SECONDS` in the controller: how long a signed snapshot may be trusted. */
export const SNAPSHOT_TTL_SECONDS = 120;
export const SNAPSHOT_CACHE_CONTROL = "private, max-age=5, must-revalidate";
/** `@idenzy/node`'s default poll, and `RevocationReconciler`'s default sweep. */
export const POLL_SECONDS = 5;
export const SWEEP_SECONDS = 30;

/**
 * The snapshot's payload, built from the entries the panel is showing, so the sample and
 * the list above it cannot describe different sets. Unix seconds, as the wire carries it.
 */
export function snapshotPayload(
  entries: readonly RevocationEntry[],
  accessTokenSeconds: number,
): string {
  const sessions = entries.filter((entry) => entry.kind === "session").map((entry) => entry.id);
  const users = entries
    .filter((entry) => entry.kind === "user")
    .map((entry) => ({
      userId: entry.id,
      revokedBefore: Math.floor(new Date(entry.revokedAt).getTime() / 1000),
    }));
  const project = entries.find((entry) => entry.kind === "project");
  return JSON.stringify(
    {
      sessions,
      users,
      projectRevokedBefore:
        project === undefined ? null : Math.floor(new Date(project.revokedAt).getTime() / 1000),
      retentionSeconds: snapshotRetentionSeconds(accessTokenSeconds),
    },
    null,
    2,
  );
}

/*
 * How a revocation reaches a verifier. Four stages, and the second carries the backstop
 * that makes the whole thing survivable.
 */

export interface RevocationStage {
  id: string;
  title: string;
  /** What this stage adds to the delay, in the fewest words that are still true. */
  cost: string;
  detail: string;
  /** The durable path behind this stage, where there is one. */
  backstop?: { title: string; detail: string };
}

export const REVOCATION_PATH: readonly RevocationStage[] = [
  {
    id: "row",
    title: "The session row is written",
    cost: "Immediate",
    detail:
      "The revocation and its outbox event are one transaction. Our own endpoints read that row on every authenticated request, so revoking a session takes effect here at once, whatever the token in hand says. Everything below is about the verifier you run.",
  },
  {
    id: "set",
    title: "The entry is written to the set",
    cost: "After the commit",
    detail:
      "Never inside it. A write that preceded the commit could revoke a session the transaction then rolled back, and a false entry is the one failure that does not correct itself: refreshing mints a new access token for the same session id, so nothing the client does clears it. The publisher never throws either, because the revocation has already happened and failing the call would report an error for work that succeeded.",
    backstop: {
      title: "And if that write is lost",
      detail:
        "The outbox event was written in the same transaction, and the reconciler replays a window of it into the set every 30 seconds. Replaying is free because the set is keyed by the instant of the revocation and not of the write, so a sweep lands on the entry it already wrote. The larger reason is not a failed write at all: Valkey is a cache, a restart empties every project's set, and nothing in the request path would notice.",
    },
  },
  {
    id: "snapshot",
    title: "The snapshot is served",
    cost: "On the next poll",
    detail:
      "The whole set, signed with the project's own key, on a secret-key endpoint. Published whole rather than as a feed of changes: entries expire on their own, so there is no cursor to drift and no missed event to recover, and a poll that fails costs nothing because the next one is complete.",
  },
  {
    id: "verifier",
    title: "Your verifier refuses the token",
    cost: `Within ${POLL_SECONDS} seconds`,
    detail:
      "The cache holds an in-process copy and answers from memory, so the check costs a hash lookup and no I/O. That is the whole design: a lookup on your request path would put our latency and our availability inside your request, which is the property offline verification exists to sell.",
  },
];
