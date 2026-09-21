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
  /**
   * Written by the connection test rather than by a revocation. It names a session that
   * never existed, which is the point: a test must never revoke a customer's own session
   * to find out whether their verifier is reading the set.
   */
  probe?: boolean;
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

/** The claim each shape is matched on, for the pill that rides beside the words. */
export const MATCHED_CLAIM: Record<RevocationKind, string> = {
  session: "sid",
  user: "sub",
  project: "aud",
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
 * What the panel can see of a customer's integration, which is one thing and not four.
 *
 * All it observes is that something holding this project's secret key read the snapshot.
 * That is not proof every backend process a customer runs holds a cache, and it is not
 * proof any of them refused a token, so the vocabulary here is deliberately narrow: a
 * read is a read, and everything past it is either tested or stated as unknown.
 */

/** Three states, and `never` is not a fault: attaching a cache is opt-in by design. */
export type IntegrationState = "never" | "stale" | "live";

export const INTEGRATION_LABELS: Record<IntegrationState, string> = {
  never: "Not connected",
  stale: "Stale",
  live: "Connected",
};

/**
 * `never` is neutral rather than a warning. Nothing is broken on a project that verifies
 * offline and waits out the token lifetime; that is what the product does without a
 * cache, and marking it amber would be inventing a fault to sell an upgrade.
 */
export const INTEGRATION_TONES: Record<IntegrationState, "success" | "warning" | "neutral"> = {
  never: "neutral",
  stale: "warning",
  live: "success",
};

/**
 * How long a read stays fresh. Eighteen missed polls: long enough that a restart, a
 * deploy or a paused container is not called stale, short enough that a poller which has
 * actually stopped is not still reported as connected.
 */
export const STALE_AFTER_SECONDS = POLL_SECONDS * 18;

/**
 * What the last observed read makes of the integration.
 *
 * Stale and never are kept apart because they need different answers: a stale poller is a
 * process to go and look at, and no poller at all is a decision nobody has made yet. A
 * page that folded them into "not working" would send an operator hunting for a broken
 * deployment they never wrote.
 */
export function integrationStateOf(polledAt: string | null, now: Date): IntegrationState {
  if (polledAt === null) return "never";
  const age = (now.getTime() - new Date(polledAt).getTime()) / 1000;
  return age > STALE_AFTER_SECONDS ? "stale" : "live";
}

/*
 * Where the snapshot is, for this project.
 *
 * Derived rather than written down. A sample naming a host this project does not answer
 * on is a sample that fails at the first request, and the three screens that quote an API
 * host must not quote three different ones.
 */

/** Which configuration the host came from, so the panel can say rather than imply. */
export type EndpointSource = "auth-domain" | "deployment";

export interface SnapshotEndpoint {
  /** The origin a verifier is pointed at, with no trailing slash. */
  issuerUrl: string;
  source: EndpointSource;
  /** What the reader is told the host was read from. */
  note: string;
}

export interface EndpointInputs {
  /** A verified custom auth domain for this project, where there is one. */
  authDomain: string | null;
  /** `authApiBaseUrl` from runtime configuration, empty on a deployment that sets none. */
  deploymentBase: string;
}

/**
 * The host in precedence order: the project's own auth domain, then whatever this
 * deployment is configured with. A custom domain wins because a project that has one is
 * being called on it.
 *
 * There used to be a third fallback — the endpoint of the region cell the project lived in
 * — which is gone with the cells. A deployment that configures no base has nothing left to
 * fall back to, which is the honest answer: it would have been guessing before.
 */
export function snapshotEndpoint(inputs: EndpointInputs): SnapshotEndpoint {
  if (inputs.authDomain !== null && inputs.authDomain !== "") {
    return {
      issuerUrl: `https://${inputs.authDomain}`,
      source: "auth-domain",
      note: "This project's verified auth domain.",
    };
  }
  return {
    issuerUrl: inputs.deploymentBase.replace(/\/+$/, ""),
    source: "deployment",
    note: "The API host this dashboard is configured against.",
  };
}

/**
 * The server example, written against this project rather than against a placeholder.
 *
 * The project id is real because it is public, and the secret key is read from the
 * environment because it is not: a key pasted into a sample is a key in somebody's
 * shell history, and this endpoint is the one place a publishable key is refused.
 */
export function cacheExample(endpoint: string, projectId: string): string {
  return `import { AccessTokenVerifier } from "@idenzy/node";
import { RemoteJwks } from "@idenzy/node/jwks";
import { RevocationCache } from "@idenzy/node/revocations";

const issuerUrl = "${endpoint}";
const projectId = "${projectId}";

// One key set, shared by the verifier and the cache, so neither fetches it twice.
const keys = new RemoteJwks(issuerUrl);

const revocations = new RevocationCache(
  // Server-side only. The endpoint takes a secret key and refuses a publishable one.
  { issuerUrl, projectId, secretKey: process.env["IDENZY_SECRET_KEY"] },
  keys,
);
// Fetches once, then keeps fetching. Its timer is unreferenced, so a script still exits.
await revocations.start();

const verifier = new AccessTokenVerifier({ issuerUrl, projectId, revocations }, keys);`;
}

/*
 * The connection test.
 *
 * A last-read timestamp says a process fetched the snapshot; it does not say that process
 * would refuse a token, and it says nothing about the other processes a customer runs. So
 * the test is in two halves and only the first is ours: we publish an entry for a session
 * that never existed and watch for the read that carries it, and the operator confirms
 * what their own verifier did with it. Neither half is inferred from the other.
 */

/** How long the panel waits for a read before calling the test unanswered. */
export const PROBE_TIMEOUT_SECONDS = 30;

export type ProbeState = "running" | "read" | "unread";

export interface ProbeRun {
  /** The synthetic session the entry names. Never a real one (see the note above). */
  sessionId: string;
  startedAt: string;
  /** When a poll carrying the probe was observed, or null while none has been. */
  readAt: string | null;
  state: ProbeState;
}

/** Seconds between publishing the probe and the read that carried it. */
export function probeLatencySeconds(run: ProbeRun): number | null {
  if (run.readAt === null) return null;
  const gap = (new Date(run.readAt).getTime() - new Date(run.startedAt).getTime()) / 1000;
  return Math.max(0, Math.round(gap * 10) / 10);
}

/**
 * What an operator runs in their own process to settle the half we cannot see.
 *
 * Both calls read the copy the cache already holds, so neither costs a request, and both
 * are needed: `status()` says whether this process can answer at all, and `isRevoked`
 * says what it would answer for the probe. A stale cache answers false to the second,
 * which is the documented fail-open and reads exactly like a working refusal without the
 * first line beside it.
 */
export function probeCheckExample(sessionId: string): string {
  return `// In the process you attached the cache to.
const status = revocations.status();
console.log(status.lastSuccessAt, status.stale); // a Date, then false

// The probe names a session that never existed, so nothing of yours is affected.
console.log(
  revocations.isRevoked({
    sessionId: "${sessionId}",
    userId: "usr_probe",
    issuedAt: new Date(),
  }),
); // true, once the poll carrying it has landed`;
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
  /**
   * The stage does not happen on its own. Exactly one is: the last, which runs only
   * where a customer has attached a cache, and a diagram that drew it like the three
   * ours perform is a five-second promise made to a project nothing is polling.
   */
  conditional?: boolean;
  /** The durable path behind this stage, where there is one. */
  backstop?: { title: string; detail: string };
}

/**
 * The four stages, with the last written against what this project is observed to do.
 *
 * A function rather than a constant because the fourth stage is not ours to perform. On a
 * project nothing polls it is a step that does not run, and the diagram says so in the
 * stage itself rather than in a caveat under it.
 */
export function revocationPath(connected: boolean): readonly RevocationStage[] {
  return [
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
      title: connected ? "Your verifier refuses the token" : "Your verifier would refuse the token",
      cost: connected ? `Within ${POLL_SECONDS} seconds` : "Not happening today",
      conditional: true,
      detail: connected
        ? "The cache holds an in-process copy and answers from memory, so the check costs a hash lookup and no I/O. That is the whole design: a lookup on your request path would put our latency and our availability inside your request, which is the property offline verification exists to sell."
        : "This is the one stage we do not perform, and nothing on this project has read the set, so today it does not happen at all: a revoked session keeps passing at your own verifier until its access token expires. A RevocationCache is what turns it on, and once attached the check costs a hash lookup and no I/O, which is the property offline verification exists to sell.",
    },
  ];
}

/*
 * Setting it up. Three steps, and the third is the one that cannot be automated: what a
 * verifier did with the token is visible where the verifier runs and nowhere else.
 */

export type SetupStepId = "configure" | "test" | "confirm";

export const SETUP_STEPS: readonly { id: SetupStepId; label: string }[] = [
  { id: "configure", label: "Configure the SDK" },
  { id: "test", label: "Run the test" },
  { id: "confirm", label: "Confirm enforcement" },
];
