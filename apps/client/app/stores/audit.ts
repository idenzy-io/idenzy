/**
 * Each project's audit trail as the panel reads it (`audit_events`, PROJECT.md 4.13.3).
 *
 * Read only, and it will stay that way: the runtime role holds INSERT and SELECT on that
 * table and no UPDATE or DELETE at all, so there is no write for this store to make. The
 * one action a screen can take is asking for an export, which the management API answers.
 *
 * The placeholder is weighted the way a real trail is: a handful of people making a few
 * changes a week, under a great deal of traffic from the project's own users. That
 * proportion is the reason the screen sets the second half aside by default, so a
 * placeholder with an even mix would hide the problem the screen solves.
 *
 * The people in it are the users store's people, not a second invented set. An entry that
 * names an account carries that account's real id, which is what lets one user's page show
 * their own history and what makes "open this in the trail" land on something. Seeded once
 * the users have arrived, the way the sessions store is, so the two screens never disagree
 * about who exists.
 *
 * A placeholder until the management client exists, like every store here.
 */

import { type ActorType, type AuditEvent, CHAIN_GENESIS, canPerform } from "~/utils/audit";
import { nameOf, type ProjectUser } from "~/utils/users";

export const useAuditStore = defineStore("audit", () => {
  const users = useUsersStore();

  const events = ref<Record<string, AuditEvent[]>>({});
  const loading = ref(true);

  /* Built once, from the first list the users store answers with. A later rename or
     erasure does not rewrite the trail, which is the point of an audit record: what it
     said at the time is what it keeps saying. */
  let seeded = false;
  watch(
    () => users.users,
    (list) => {
      if (seeded || list.length === 0) return;
      seeded = true;
      events.value = {
        prj_personal: streamFor(
          11,
          70,
          list.filter((user) => user.projectId === "prj_personal"),
        ),
        prj_acme: streamFor(
          29,
          460,
          list.filter((user) => user.projectId === "prj_acme"),
        ),
      };
      loading.value = false;
    },
    { immediate: true },
  );

  function forProject(projectId: string): AuditEvent[] {
    return events.value[projectId] ?? [];
  }

  /**
   * The trail for one account: what was done to them, and what they did themselves. Both,
   * because an investigation asks "what happened to this person" and a suspension by an
   * operator and a sign-in by the person are the same story from two ends.
   */
  function forSubject(projectId: string, userId: string): AuditEvent[] {
    return forProject(projectId).filter(
      (event) => event.target === userId || event.actorId === userId,
    );
  }

  /** The newest entry, which is the chain's tip. */
  function tipOf(projectId: string): AuditEvent | null {
    return forProject(projectId).reduce<AuditEvent | null>(
      (tip, event) => (tip === null || event.seq > tip.seq ? event : tip),
      null,
    );
  }

  return { events, loading, forProject, forSubject, tipOf };
});

/*
 * The placeholder trail. Deterministic, so a reload shows the same month.
 */

function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** A hex digest of the right shape. The real one is H(prev_hash || canonical(entry)). */
function digest(next: () => number): string {
  let out = "";
  for (let index = 0; index < 64; index += 1) {
    out += Math.floor(next() * 16).toString(16);
  }
  return out;
}

function pick<T>(next: () => number, values: readonly T[]): T {
  return values[Math.floor(next() * values.length)] ?? (values[0] as T);
}

interface Actor {
  type: ActorType;
  id: string;
  name: string;
}

/** The people on the team, an automation, and support. Names, because that is the point. */
const TEAM: readonly Actor[] = [
  { type: "member", id: "mem_hasan", name: "Hasan Musluoglu" },
  { type: "member", id: "mem_ana", name: "Ana Rodríguez" },
  { type: "member", id: "mem_pieter", name: "Pieter de Vries" },
  { type: "member", id: "mem_mei", name: "Mei Tanaka" },
  { type: "api_key", id: "key_ci", name: "CI deploy key" },
  { type: "api_key", id: "key_backend", name: "Backend service key" },
  { type: "staff", id: "stf_support", name: "Idenzy support" },
];

const MEMBERS = TEAM.filter((actor) => actor.type === "member");

/**
 * Who a project's entries can be about.
 *
 * Two lists rather than one, because an operator can act on anybody and only somebody who
 * has signed in can be the one acting: an account whose row says it has never signed in
 * must not appear in the trail signing in, which is the sort of contradiction a reader
 * finds in ten seconds and cannot unsee.
 */
interface Cast {
  everyone: readonly ProjectUser[];
  signedIn: readonly ProjectUser[];
}

/**
 * One of the project's own accounts, as the trail names it: the real id, and whatever the
 * account was called. An erased account has no name left, so the entry says so rather than
 * inventing one, which is what a pseudonymous subject looks like in practice.
 */
function subject(next: () => number, people: readonly ProjectUser[]): Actor {
  const person = people.length > 0 ? pick(next, people) : null;
  if (person === null) {
    return { type: "end_user", id: `usr_${digest(next).slice(0, 16)}`, name: "A user" };
  }
  return {
    type: "end_user",
    id: person.id,
    name: person.deletedAt === null ? nameOf(person) : "Deleted user",
  };
}

/** What the team does, weighted so settings are ordinary and a removal is not. */
const TEAM_ACTIONS: readonly { action: string; weight: number }[] = [
  { action: "member.signed_in", weight: 26 },
  { action: "project.settings_updated", weight: 20 },
  { action: "session.revoked", weight: 8 },
  { action: "user.suspended", weight: 6 },
  { action: "key.created", weight: 5 },
  { action: "key.revoked", weight: 4 },
  { action: "project.origin_added", weight: 5 },
  { action: "project.origin_removed", weight: 3 },
  { action: "project.domain_verified", weight: 4 },
  { action: "member.invited", weight: 4 },
  { action: "member.joined", weight: 3 },
  { action: "member.role_changed", weight: 3 },
  { action: "user.mfa_removed", weight: 3 },
  { action: "data.export_requested", weight: 2 },
  { action: "data.erasure_completed", weight: 2 },
  { action: "member.removed", weight: 1 },
  { action: "staff.access_granted", weight: 1 },
];

const END_USER_ACTIONS: readonly { action: string; weight: number }[] = [
  { action: "session.created", weight: 48 },
  { action: "session.signed_out", weight: 24 },
  { action: "user.password_changed", weight: 6 },
  { action: "user.mfa_enrolled", weight: 4 },
  { action: "session.reuse_detected", weight: 1 },
];

/**
 * The same draw, over the actions that actor could actually have performed.
 *
 * An API key has no browser and no password, so it cannot sign in to the dashboard or
 * accept an invitation; drawing from the whole table put exactly that in the trail, and an
 * audit story with a CI deploy key signing in undermines the role model it is evidence for
 * (notes/audit.md P1).
 */
function weightedFor(
  next: () => number,
  actor: ActorType,
  table: readonly { action: string; weight: number }[],
): string {
  const allowed = table.filter((entry) => canPerform(entry.action, actor));
  return weighted(next, allowed.length > 0 ? allowed : table);
}

function weighted(
  next: () => number,
  table: readonly { action: string; weight: number }[],
): string {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = next() * total;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll <= 0) return entry.action;
  }
  return table[0]?.action ?? "project.settings_updated";
}

const SETTINGS_FIELDS = [
  "the access token lifetime",
  "the idle timeout",
  "the SMS spend cap",
  "the password policy",
  "the claim template",
  "the passkey relying party",
];

/**
 * What a settings change moved, so the entry can show a before and an after.
 *
 * The note asks for those to lead the detail: "changed the idle timeout" is the headline
 * and the two values are the answer to the question that follows it, and an auditor
 * reading a month of changes is reading for the values rather than for the field names.
 */
const SETTINGS_CHANGES: Record<string, { from: string; to: string }> = {
  "the access token lifetime": { from: "5m", to: "10m" },
  "the idle timeout": { from: "14d", to: "7d" },
  "the SMS spend cap": { from: "$10.00", to: "$25.00" },
  "the password policy": { from: "8 characters", to: "12 characters" },
  "the claim template": { from: "2 claims", to: "3 claims" },
  "the passkey relying party": { from: "example.com", to: "acme.com" },
};

const IPS = ["203.0.113.7", "198.51.100.42", "192.0.2.15", "203.0.113.88", "198.51.100.9"];

const AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36",
  "idenzy-node/0.4.1",
];

/**
 * What the action was done to, where it was done to anything.
 *
 * `self` is the actor when the actor is one of the project's own users, and it is what the
 * entry then targets: somebody changing their own password is not an operator changing
 * somebody else's, and a trail that picked a stranger for the target would put a row on
 * the wrong person's page.
 */
function targetFor(
  action: string,
  next: () => number,
  cast: Cast,
  self: Actor | null,
): { id: string | null; name: string | null } {
  if (
    action === "member.invited" ||
    action === "member.removed" ||
    action === "member.role_changed"
  ) {
    const person = pick(next, MEMBERS);
    return { id: person.id, name: person.name };
  }
  if (action.startsWith("key.")) {
    return {
      id: `key_${digest(next).slice(0, 10)}`,
      name: pick(next, ["CI deploy", "Backend service", "Migration"]),
    };
  }
  if (action.startsWith("project.origin_")) {
    return { id: null, name: pick(next, ["https://app.acme.com", "https://staging.acme.com"]) };
  }
  if (action === "project.domain_verified") {
    return { id: null, name: pick(next, ["acme.com", "mail.acme.com", "auth.acme.com"]) };
  }
  if (action.startsWith("user.") || action.startsWith("data.") || action === "session.revoked") {
    const person = self ?? subject(next, cast.everyone);
    return { id: person.id, name: person.name };
  }
  return { id: null, name: null };
}

function metadataFor(action: string, next: () => number): Record<string, unknown> {
  /* The request id is a column of its own now, so it is not repeated here: an entry that
     said the same thing twice would leave a reader wondering which one was authoritative. */
  const meta: Record<string, unknown> = {};
  if (action === "project.settings_updated") {
    const field = pick(next, SETTINGS_FIELDS);
    const change = SETTINGS_CHANGES[field];
    meta.field = field;
    if (change !== undefined) {
      meta.from = change.from;
      meta.to = change.to;
    }
  }
  if (action === "session.created") {
    meta.method = pick(next, ["password", "passkey", "email_otp", "oauth:google"]);
  }
  if (action === "session.reuse_detected") meta.sessionsRevoked = 1 + Math.floor(next() * 4);
  if (action === "staff.access_granted") {
    meta.reason = "Support ticket #4821";
    meta.expiresInMinutes = 60;
  }
  if (action === "member.role_changed") meta.role = pick(next, ["admin", "developer", "viewer"]);
  return meta;
}

/** Roughly one entry in six is the team's. The rest is the customer's own traffic. */
function eventFrom(
  next: () => number,
  seq: number,
  at: Date,
  prevHash: string,
  cast: Cast,
): AuditEvent {
  const team = next() < 0.18;
  const actor: Actor = team ? pick(next, TEAM) : subject(next, cast.signedIn);
  const action = team
    ? weightedFor(next, actor.type, TEAM_ACTIONS)
    : weighted(next, END_USER_ACTIONS);
  const target = targetFor(action, next, cast, team ? null : actor);

  return {
    id: `evt_${digest(next).slice(0, 24)}`,
    seq,
    createdAt: at.toISOString(),
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
    action,
    target: target.id,
    targetName: target.name,
    ip: pick(next, IPS),
    ua: actor.type === "api_key" ? (AGENTS[3] ?? null) : pick(next, AGENTS.slice(0, 3)),
    requestId: `req_${digest(next).slice(0, 20)}`,
    metadata: metadataFor(action, next),
    prevHash,
    entryHash: digest(next),
  };
}

/**
 * A month of trail, oldest first, each entry linked to the one before it.
 *
 * `count` is a floor rather than the figure: a project's trail is mostly its own users
 * signing in, so a month over a hundred and thirty accounts is hundreds of entries and not
 * seventy. Scaled by the number of accounts, which is also what stops one account's page
 * showing an empty record while the project's own screen is full of rows.
 */
function streamFor(seed: number, count: number, people: readonly ProjectUser[]): AuditEvent[] {
  const next = seeded(seed);
  const span = 30 * 24 * 60 * 60 * 1000;
  const to = Date.now() - 40_000;
  const total = Math.max(count, people.length * 4);
  const cast: Cast = {
    everyone: people,
    signedIn: people.filter((person) => person.lastSignInAt !== null),
  };

  /* Instants first, then sorted, then linked. Squaring the draw leans the trail toward
     the recent end, which is the shape a live project's actually has. */
  const times = Array.from({ length: total }, () => to - Math.round(next() ** 2 * span)).sort(
    (first, later) => first - later,
  );

  const out: AuditEvent[] = [];
  let prevHash = CHAIN_GENESIS;
  for (const [index, at] of times.entries()) {
    const event = eventFrom(next, index + 1, new Date(at), prevHash, cast);
    prevHash = event.entryHash;
    out.push(event);
  }
  return out;
}
