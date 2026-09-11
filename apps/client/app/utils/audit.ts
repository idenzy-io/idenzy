/**
 * The audit trail as a record of what happened on the project (`audit_events`,
 * PROJECT.md 4.11, 4.13.3).
 *
 * It is read as an activity record and not as a log. The question it answers is "who did
 * what, and when", so an entry is written as a sentence with a person at the front, and
 * the machine-readable parts of the row sit behind the row rather than in it. An auditor
 * looking for the moment somebody changed a role is not scanning identifiers.
 *
 * The trail holds two kinds of entry and they are not equally interesting. Everything a
 * project's own users do arrives here too, and on a live project that is almost all of
 * it: sign-ins, refreshes, sign-outs, thousands a day. An organisation's audit log where
 * nine rows in ten are "somebody signed in" is one nobody reads, so that traffic is off
 * by default, counted rather than hidden, and one switch away.
 *
 * Three properties of the table shape what the detail behind a row can claim.
 *
 * The order is `seq` and never `created_at`. Time ties at millisecond precision and the
 * chain needs one answer about which entry came first, so the sequence is the order.
 *
 * The chain is only a chain when the view is contiguous. Every entry links to the one
 * before it, so a narrowed list is a set of entries whose links point at rows not on
 * screen, and the panel has to stop claiming a link the moment anything is filtered.
 *
 * `ip` and `ua` sit outside the digest. They are the two fields a lawful erasure may
 * pseudonymise, and a chain that hashed them would read a compliant erasure as tampering.
 */

import { anyOf, csvCell, type TimeWindow, within } from "./filters";

/*
 * Who did it.
 */

/**
 * `member` is somebody on the customer's team acting in this dashboard, and `end_user`
 * is one of their product's own users acting through the SDK. The table stores one
 * `actor_type` column and the two used to share a value here, which is the conflation
 * that made this screen unreadable: they are different people doing different things,
 * and only one of them is what an organisation audits.
 */
export type ActorType = "member" | "api_key" | "staff" | "end_user" | "system";

export const ACTOR_TYPES: readonly ActorType[] = [
  "member",
  "api_key",
  "staff",
  "end_user",
  "system",
];

/** The actors an organisation's audit log is actually about. */
export const TEAM_ACTORS: readonly ActorType[] = ["member", "api_key", "staff", "system"];

export const ACTOR_LABELS: Record<ActorType, string> = {
  member: "Team member",
  api_key: "API key",
  staff: "Idenzy staff",
  end_user: "One of your users",
  system: "System",
};

/** Written out in full so @nuxt/icon bundles them. */
export const ACTOR_ICONS: Record<ActorType, string> = {
  member: "material-symbols:person-outline",
  api_key: "material-symbols:key-outline",
  staff: "material-symbols:support-agent",
  end_user: "material-symbols:group-outline",
  system: "material-symbols:settings-suggest-outline",
};

export const ACTOR_NOTES: Record<ActorType, string> = {
  member: "Somebody on your team, acting in this dashboard.",
  api_key: "A secret key acting through the management API. The key's own name, never its value.",
  staff:
    "One of ours, under a time-boxed grant with a reason recorded against it. These are the entries an auditor reads first.",
  end_user: "One of your product's users, signing in or changing their own account.",
  system: "A sweeper, a relay or a scheduled job. Nobody pressed anything.",
};

export function isTeamActor(actor: ActorType): boolean {
  return actor !== "end_user";
}

/*
 * An entry.
 */

export interface AuditEvent {
  id: string;
  /** The total order the chain is built in. Never `createdAt`: that ties at ms precision. */
  seq: number;
  createdAt: string;
  actorType: ActorType;
  /** Pseudonymous, and it survives erasure so the trail stays attributable. */
  actorId: string | null;
  /** What to call the actor on screen: a person's name, a key's name, an address. */
  actorName: string;
  action: string;
  /** What the action was done to, when that is not the actor. */
  target: string | null;
  /** The target as a reader knows it, where the id is not how anybody refers to it. */
  targetName: string | null;
  ip: string | null;
  ua: string | null;
  /**
   * The request that produced the entry, for correlating it with a customer's own logs
   * and with a support ticket. Null for an entry the relay wrote from a background job,
   * which had no request behind it.
   */
  requestId: string | null;
  metadata: Record<string, unknown>;
  prevHash: string;
  entryHash: string;
}

/*
 * What was done.
 */

export type AuditCategory = "team" | "keys" | "settings" | "accounts" | "data" | "sessions";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  "team",
  "keys",
  "settings",
  "accounts",
  "data",
  "sessions",
];

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  team: "Team",
  keys: "API keys",
  settings: "Project settings",
  accounts: "User accounts",
  data: "Data requests",
  sessions: "Sessions",
};

/**
 * The colour each category wears, one chart slot each in the order the categories are
 * listed. Those six are the panel's only categorical palette that has been checked pair
 * by pair for separation under colour-vision deficiency, so a seventh category takes a
 * seventh check rather than a seventh colour picked to look different.
 */
export const CATEGORY_SLOTS: Record<AuditCategory, string> = {
  team: "chart-1",
  keys: "chart-2",
  settings: "chart-3",
  accounts: "chart-4",
  data: "chart-5",
  sessions: "chart-6",
};

export interface ActionInfo {
  id: string;
  category: AuditCategory;
  /**
   * What the row says the actor did, with the actor's name already in front of it.
   * `{target}` is filled from the entry and `{field}` from its metadata.
   */
  phrase: string;
  /**
   * Worth a second look on a security review. One flag rather than a severity scale: a
   * scale invites an argument about whether something is a four or a five, and the only
   * question here is whether somebody should read the entry.
   */
  notable: boolean;
}

const CATALOGUE: readonly ActionInfo[] = [
  // The team, which is what most of this screen is for.
  { id: "member.invited", category: "team", phrase: "invited {target}", notable: true },
  { id: "member.joined", category: "team", phrase: "joined the project", notable: false },
  { id: "member.removed", category: "team", phrase: "removed {target}", notable: true },
  {
    id: "member.role_changed",
    category: "team",
    phrase: "changed the role of {target}",
    notable: true,
  },
  {
    id: "member.signed_in",
    category: "team",
    phrase: "signed in to the dashboard",
    notable: false,
  },
  {
    id: "staff.access_granted",
    category: "team",
    phrase: "was granted time-boxed access to this project",
    notable: true,
  },

  // Keys and settings.
  { id: "key.created", category: "keys", phrase: "created the API key {target}", notable: true },
  { id: "key.revoked", category: "keys", phrase: "revoked the API key {target}", notable: true },
  {
    id: "project.settings_updated",
    category: "settings",
    phrase: "changed {field}",
    notable: false,
  },
  {
    id: "project.origin_added",
    category: "settings",
    phrase: "allowed the origin {target}",
    notable: true,
  },
  {
    id: "project.origin_removed",
    category: "settings",
    phrase: "stopped allowing the origin {target}",
    notable: true,
  },
  {
    id: "project.domain_verified",
    category: "settings",
    phrase: "verified the domain {target}",
    notable: false,
  },

  // Things done to a customer's own users, from the dashboard or the API.
  { id: "user.suspended", category: "accounts", phrase: "suspended {target}", notable: true },
  { id: "user.deleted", category: "accounts", phrase: "deleted {target}", notable: true },
  {
    id: "user.mfa_removed",
    category: "accounts",
    phrase: "removed the second factor from {target}",
    notable: true,
  },
  {
    id: "session.revoked",
    category: "sessions",
    phrase: "revoked a session for {target}",
    notable: true,
  },

  // Data requests.
  {
    id: "data.export_requested",
    category: "data",
    phrase: "requested a data export for {target}",
    notable: false,
  },
  {
    id: "data.erasure_completed",
    category: "data",
    phrase: "completed an erasure for {target}",
    notable: true,
  },

  // What a project's own users do. Off by default, and the reason the switch exists.
  { id: "session.created", category: "sessions", phrase: "signed in", notable: false },
  { id: "session.signed_out", category: "sessions", phrase: "signed out", notable: false },
  {
    id: "session.reuse_detected",
    category: "sessions",
    phrase: "replayed a refresh token, and every session in the family was revoked",
    notable: true,
  },
  {
    id: "user.password_changed",
    category: "accounts",
    phrase: "changed their password",
    notable: false,
  },
  {
    id: "user.mfa_enrolled",
    category: "accounts",
    phrase: "enrolled a second factor",
    notable: false,
  },
];

const BY_ID = new Map(CATALOGUE.map((entry) => [entry.id, entry]));

export const KNOWN_ACTIONS: readonly ActionInfo[] = CATALOGUE;

const PREFIX_CATEGORIES: Record<string, AuditCategory> = {
  member: "team",
  staff: "team",
  key: "keys",
  project: "settings",
  user: "accounts",
  data: "data",
  session: "sessions",
};

/**
 * What the panel knows about an action, or what it can work out from the string.
 *
 * An unknown action keeps its own text as the phrase and takes the category its prefix
 * implies. Nothing is dropped and nothing is called an error: a release that starts
 * writing a new action must not make the entries it writes invisible in the screen an
 * auditor is reading.
 */
export function actionInfo(action: string): ActionInfo {
  const known = BY_ID.get(action);
  if (known) return known;
  const prefix = action.split(".")[0] ?? "";
  return {
    id: action,
    category: PREFIX_CATEGORIES[prefix] ?? "settings",
    phrase: action,
    notable: false,
  };
}

export function categoryOf(action: string): AuditCategory {
  return actionInfo(action).category;
}

export function isNotable(action: string): boolean {
  return actionInfo(action).notable;
}

/**
 * What the row says, after the actor's name.
 *
 * A placeholder with nothing behind it becomes a word rather than an empty gap, because
 * an entry whose target was erased still has to read as a sentence. That is not a rare
 * case: erasure is a thing this product does on request, and the trail outlives it.
 */
export function phraseFor(event: AuditEvent): string {
  const info = actionInfo(event.action);
  const field = typeof event.metadata.field === "string" ? event.metadata.field : "a setting";
  return info.phrase
    .replace("{target}", event.targetName ?? event.target ?? "a record")
    .replace("{field}", field);
}

/*
 * The chain.
 */

/** The first entry of a project's chain links to this. Sixty-four zeroes. */
export const CHAIN_GENESIS = "0".repeat(64);

export function isGenesis(hash: string): boolean {
  return hash === CHAIN_GENESIS;
}

/** Enough of a digest to compare two by eye, which is all a screen ever asks of one. */
export function shortHash(hash: string): string {
  return hash.length <= 16 ? hash : `${hash.slice(0, 12)}…${hash.slice(-4)}`;
}

/** The fields held outside `entry_hash`, and named once so nothing disagrees. */
export const FIELDS_OUTSIDE_DIGEST: readonly string[] = ["ip", "ua"];

/** Whether the newer entry links to the older one, which is what the chain claims. */
export function linksTo(newer: AuditEvent, older: AuditEvent): boolean {
  return newer.prevHash === older.entryHash;
}

/** Newest first, by the sequence the chain was built in. */
export function orderBySeq(events: readonly AuditEvent[]): AuditEvent[] {
  return [...events].sort((first, next) => next.seq - first.seq);
}

/**
 * Whether a list is an unbroken run of the chain, so a screen may claim the links between
 * its rows. A narrowed list is almost never one, and claiming a link there would report a
 * break that is only the filter.
 */
export function isContiguous(events: readonly AuditEvent[]): boolean {
  const ordered = orderBySeq(events);
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const newer = ordered[index];
    const older = ordered[index + 1];
    if (!newer || !older) return false;
    if (newer.seq !== older.seq + 1 || !linksTo(newer, older)) return false;
  }
  return true;
}

/*
 * Narrowing it.
 */

export interface AuditFilters {
  /** Free text, matched across everything a reader can see on the row. */
  text: string;
  actors: ActorType[];
  categories: AuditCategory[];
  /** One person, key or user, picked off a row or the who list. */
  actorId: string | null;
  notableOnly: boolean;
  window: TimeWindow;
  /**
   * Whether the customer's own users' activity is in the list. Off by default: on a live
   * project it is nearly every row, and a record of what the organisation did is not
   * readable underneath it.
   */
  includeEndUsers: boolean;
}

export const NO_AUDIT_FILTERS: AuditFilters = {
  text: "",
  actors: [],
  categories: [],
  actorId: null,
  notableOnly: false,
  window: "30d",
  includeEndUsers: false,
};

/** What is set, for the button that clears it. The window is a control of its own. */
export function auditFilterCount(filters: AuditFilters): number {
  return (
    (filters.text.trim() === "" ? 0 : 1) +
    (filters.actors.length > 0 ? 1 : 0) +
    (filters.categories.length > 0 ? 1 : 0) +
    (filters.actorId === null ? 0 : 1) +
    (filters.notableOnly ? 1 : 0) +
    (filters.includeEndUsers ? 1 : 0)
  );
}

/** Everything on the row a reader can see, lowercased once per entry. */
function haystack(event: AuditEvent): string {
  return [
    event.actorName,
    event.actorId ?? "",
    phraseFor(event),
    event.action,
    event.targetName ?? "",
    event.target ?? "",
    event.ip ?? "",
    event.requestId ?? "",
    ...Object.entries(event.metadata).flatMap(([key, value]) => [key, String(value)]),
  ]
    .join(" ")
    .toLowerCase();
}

function matches(event: AuditEvent, filters: AuditFilters, text: string): boolean {
  if (!filters.includeEndUsers && !isTeamActor(event.actorType)) return false;
  if (!anyOf(filters.actors, event.actorType)) return false;
  if (!anyOf(filters.categories, categoryOf(event.action))) return false;
  if (filters.actorId !== null && event.actorId !== filters.actorId) return false;
  if (filters.notableOnly && !isNotable(event.action)) return false;
  return text === "" || haystack(event).includes(text);
}

/**
 * The record a reader has narrowed to, newest first.
 *
 * Text matches anything visible, the sentence included, so searching for "invited" finds
 * the invitations without anybody having to know the action is called `member.invited`.
 */
export function filterAudit(
  events: readonly AuditEvent[],
  filters: AuditFilters,
  now: Date,
): AuditEvent[] {
  const text = filters.text.trim().toLowerCase();
  return orderBySeq(
    events.filter(
      (event) => within(event.createdAt, filters.window, now) && matches(event, filters, text),
    ),
  );
}

/** How many rows the end-user switch is keeping out, for the line that offers it. */
export function hiddenEndUserCount(
  events: readonly AuditEvent[],
  filters: AuditFilters,
  now: Date,
): number {
  if (filters.includeEndUsers) return 0;
  return events.filter(
    (event) => !isTeamActor(event.actorType) && within(event.createdAt, filters.window, now),
  ).length;
}

/*
 * Reading it back.
 */

export interface AuditDay {
  /** The local date the entries fall on, as `YYYY-MM-DD`. */
  key: string;
  label: string;
  events: AuditEvent[];
}

const DAY_LABEL = new Intl.DateTimeFormat("en", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

function dayKey(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/**
 * The record grouped under the day it happened on, newest day first.
 *
 * A date heading rather than a timestamp on every row is what turns a list into a record
 * of the past: a reader thinks in days, and the exact instant only matters once they have
 * found the entry they came for.
 */
export function groupByDay(events: readonly AuditEvent[], now: Date): AuditDay[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const days = new Map<string, AuditEvent[]>();

  for (const event of orderBySeq(events)) {
    const key = dayKey(new Date(event.createdAt));
    const held = days.get(key);
    if (held) held.push(event);
    else days.set(key, [event]);
  }

  return [...days.entries()].map(([key, held]) => ({
    key,
    label:
      key === today
        ? "Today"
        : key === yesterday
          ? "Yesterday"
          : DAY_LABEL.format(new Date(held[0]?.createdAt ?? now)),
    events: held,
  }));
}

export interface AuditSummary {
  /** Entries in the window, once the end-user traffic is set aside. */
  changes: number;
  /** Distinct people, keys and staff behind them. */
  people: number;
  notable: number;
}

/** What the header says: how much happened, and how many hands it took. */
export function summarise(events: readonly AuditEvent[]): AuditSummary {
  const team = events.filter((event) => isTeamActor(event.actorType));
  return {
    changes: team.length,
    people: new Set(team.map((event) => event.actorId ?? event.actorName)).size,
    notable: team.filter((event) => isNotable(event.action)).length,
  };
}

/** Who appears in the record, most active first, for the list a reader filters from. */
export function actorsIn(events: readonly AuditEvent[]): {
  id: string;
  name: string;
  type: ActorType;
  count: number;
}[] {
  const seen = new Map<string, { id: string; name: string; type: ActorType; count: number }>();
  for (const event of events) {
    if (!isTeamActor(event.actorType)) continue;
    const id = event.actorId ?? event.actorName;
    const held = seen.get(id);
    if (held) held.count += 1;
    else seen.set(id, { id, name: event.actorName, type: event.actorType, count: 1 });
  }
  return [...seen.values()].sort((first, next) => next.count - first.count);
}

/*
 * Taking it away.
 */

/**
 * What is on screen, as CSV. The management API is the authoritative export and covers
 * the whole trail; this one covers the rows a reader has narrowed to, which is the thing
 * they were about to paste into a ticket.
 */
export function auditCsv(events: readonly AuditEvent[]): string {
  const header = ["when", "who", "what", "action", "target", "request_id", "ip", "entry_hash"];
  const rows = orderBySeq(events).map((event) =>
    [
      event.createdAt,
      event.actorName,
      phraseFor(event),
      event.action,
      event.targetName ?? event.target ?? "",
      event.requestId ?? "",
      event.ip ?? "",
      event.entryHash,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

/** PROJECT.md 4.13.3. Driven by the project's compliance tier, not by a setting here. */
export const RETENTION_YEARS = { standard: 1, hipaa: 6 } as const;

/**
 * How far behind the record runs, in seconds. One relay writes the chain and it sweeps on
 * this interval, so an entry appears a moment after the thing it records rather than with
 * it. Said on the screen, because otherwise somebody refreshes for a row that is four
 * seconds from existing.
 */
export const RELAY_INTERVAL_SECONDS = 5;

/*
 * Who can have done what.
 *
 * A service credential cannot sign in to a dashboard and cannot join a project: those are
 * things a person does with a browser, and an API key is a string in somebody's server.
 * The trail said otherwise, and an audit story that has a CI deploy key signing in to the
 * dashboard undermines the role model it exists to evidence (notes/audit.md P1). So each
 * action names the actors that can perform it, the fixtures pick an actor that can, and a
 * test asserts no entry breaks it.
 */

const HUMAN_ONLY: readonly ActorType[] = ["member"];
const STAFF_ONLY: readonly ActorType[] = ["staff"];
const OPERATORS: readonly ActorType[] = ["member", "api_key", "staff", "system"];

export const ACTION_ACTORS: Record<string, readonly ActorType[]> = {
  /* A browser session on the dashboard. A key has no browser and no password. */
  "member.signed_in": HUMAN_ONLY,
  /* Accepting an invitation, which is a person following a link in their mail. */
  "member.joined": HUMAN_ONLY,
  "member.invited": HUMAN_ONLY,
  "member.removed": HUMAN_ONLY,
  "member.role_changed": HUMAN_ONLY,
  /* Ours, and granted to a person rather than taken by one. */
  "staff.access_granted": STAFF_ONLY,
  /* A credential cannot mint or revoke a credential of its own class here. */
  "key.created": HUMAN_ONLY,
  "key.revoked": HUMAN_ONLY,
};

/** Whether that actor could have performed that action at all. */
export function canPerform(action: string, actor: ActorType): boolean {
  return (ACTION_ACTORS[action] ?? OPERATORS).includes(actor);
}

/** The actions an actor of that kind can be the author of, for building a trail. */
export function actionsFor(actor: ActorType, actions: readonly string[]): string[] {
  return actions.filter((action) => canPerform(action, actor));
}

/*
 * What "sensitive" means, said rather than implied.
 *
 * The flag used to be called "worth reading", which reads as an editorial judgement about
 * the rest of the trail: everything here is worth reading, and a filter that says
 * otherwise is one an auditor cannot trust (notes/audit.md P2). "Sensitive" is a category
 * with a rule behind it, and the rule is on the screen next to the control.
 */
export const SENSITIVE_LABEL = "Sensitive";

export const SENSITIVE_CRITERION =
  "An entry is marked sensitive when it changes who can reach this project or what they can reach: membership and roles, API keys, a second factor removed from an account, a session revoked, an erasure completed, or support being let in. Nothing else is judged, and an unmarked entry is not a less important one.";

/*
 * What the panel can honestly claim about integrity.
 *
 * The runtime role holds INSERT and SELECT and no UPDATE or DELETE, and every entry links
 * to the one before it. That means no code path in the product can change an entry and
 * that a change made underneath it is detectable. It does not mean nobody with direct
 * access to the database can alter storage, and a screen that said so would be making a
 * promise the architecture does not make (notes/audit.md P2).
 */
export const INTEGRITY_CLAIMS: readonly { id: string; label: string; detail: string }[] = [
  {
    id: "append",
    label: "Entries cannot be edited through the product",
    detail:
      "The runtime role holds INSERT and SELECT on the table and no UPDATE or DELETE at all, so no control in this panel and no code path we could add here can change an entry after it is written.",
  },
  {
    id: "chain",
    label: "A change made underneath it is detectable",
    detail:
      "Every entry carries a digest of itself and of the one before it, so an alteration made with direct access to the database breaks the chain from that point on and can be found by verifying it. Detectable is not the same as impossible: somebody with that access can still write to storage.",
  },
  {
    id: "outside",
    label: "Two fields sit outside the digest",
    detail:
      "The address and the user agent are the two a lawful erasure may pseudonymise, so they are not covered by the chain. A compliant erasure would otherwise read as tampering. Who did what to whom and when is covered.",
  },
];

/*
 * What an export actually covers.
 *
 * The button says "Export filtered view", so the file has to be the filtered view and the
 * reader has to be able to check that before it lands on their disk: the scope, the
 * period, the project, and whether their own users' activity is in it or out of it
 * (notes/audit.md). An export whose contents disagree with the summary on screen is the
 * one thing an auditor cannot use.
 */

export interface AuditScopeLine {
  label: string;
  value: string;
}

export function auditScope(
  filters: AuditFilters,
  projectName: string,
  rows: number,
  windowLabel: string,
): AuditScopeLine[] {
  const lines: AuditScopeLine[] = [
    { label: "Project", value: projectName },
    { label: "Period", value: windowLabel },
    { label: "Entries", value: `${rows.toLocaleString("en")} on screen` },
    {
      label: "Your users' activity",
      value: filters.includeEndUsers ? "Included" : "Excluded",
    },
  ];
  if (filters.text.trim() !== "") lines.push({ label: "Search", value: filters.text.trim() });
  if (filters.actorId !== null) lines.push({ label: "Actor", value: "One actor only" });
  if (filters.actors.length > 0) {
    lines.push({
      label: "Actor kinds",
      value: filters.actors.map((actor) => ACTOR_LABELS[actor]).join(", "),
    });
  }
  if (filters.categories.length > 0) {
    lines.push({
      label: "Categories",
      value: filters.categories.map((category) => CATEGORY_LABELS[category]).join(", "),
    });
  }
  if (filters.notableOnly) {
    lines.push({ label: "Marked", value: `${SENSITIVE_LABEL} changes only` });
  }
  return lines;
}

/**
 * What the file does not carry, said before it is downloaded.
 *
 * The two fields outside the digest are in it, because an export is for reading rather
 * than for verifying; what is not in it is anything this view was narrowed away from, and
 * a reader who exports a filtered view and later treats it as the whole trail has made the
 * mistake this line exists to stop.
 */
export const EXPORT_CAVEAT =
  "The file holds exactly the entries on screen, in the order they are shown. It is a copy of a narrowed view and not the whole trail: the management API is the authoritative export.";
