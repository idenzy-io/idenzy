/**
 * Each project's sending domains and the figures the screen shows beside them.
 *
 * A domain is a row of `project_domains` with `type = 'email'`, read and written through
 * the management API; the DKIM tokens and the bounce route come back on the row when the
 * identity is created, and the panel only ever displays them. A placeholder until that
 * client exists, like every store here.
 *
 * `recheck` is the one piece of placeholder behaviour worth naming: it finds the next
 * record instead of asking DNS, so the flow a customer walks can be walked here. The
 * real one polls the provider and writes whatever it saw, including nothing.
 */

import {
  afterRemoval,
  type DnsRecord,
  isReadyToSend,
  mailFromFor,
  type SendingDomain,
  SHARED_DOMAIN,
  useForSending,
} from "~/utils/sending-domains";

export interface DomainStats {
  /** Over the last thirty days, oldest day first. */
  sent: number;
  sentDaily: number[];
  delivered: number;
  bounced: number;
  bouncedDaily: number[];
  complained: number;
  /** Today against the project's own ceiling, which grows with a clean bounce rate. */
  sentToday: number;
  dailyCeiling: number;
}

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

/** The provider's bounce host in the cell's region (PROJECT.md 11.2). */
const FEEDBACK_HOST = "feedback-smtp.eu-west-1.amazonses.com";

export const useSendingDomainsStore = defineStore("sending-domains", () => {
  const domains = ref<Record<string, SendingDomain[]>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    domains.value = { prj_personal: personalDomains(), prj_acme: acmeDomains() };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): SendingDomain[] {
    return domains.value[projectId] ?? [];
  }

  /** The domain the From line carries. The shared row is always there, so never null. */
  function sendingFor(projectId: string): SendingDomain | null {
    return forProject(projectId).find((domain) => domain.inUse) ?? null;
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function write(projectId: string, next: SendingDomain[]) {
    domains.value = { ...domains.value, [projectId]: next };
    stamp(projectId);
  }

  /**
   * Creates the identity and returns the row, records and all. Adding a domain changes
   * nothing about what sends: the new row is verifying, and moving the From line to it
   * is a second decision made once the records resolve.
   */
  async function add(projectId: string, domain: string): Promise<SendingDomain> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const created = verifyingDomain(domain);
    write(projectId, [...forProject(projectId), created]);
    return created;
  }

  async function remove(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(projectId, afterRemoval(forProject(projectId), id));
  }

  async function use(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(projectId, useForSending(forProject(projectId), id));
  }

  /**
   * Looks the records up again. The placeholder finds one more each time, so the state
   * a customer sees between publishing a record and the check catching up is reachable
   * here; a domain whose required records are all found becomes verified in the same
   * write, because those two facts are one fact.
   */
  async function recheck(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const checkedAt = new Date().toISOString();
    write(
      projectId,
      forProject(projectId).map((domain) => {
        if (domain.id !== id || domain.shared) return domain;
        const next = { ...domain, records: foundNext(domain.records), checkedAt };
        return { ...next, status: isReadyToSend(next) ? ("verified" as const) : next.status };
      }),
    );
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  function stats(projectId: string): DomainStats {
    return projectId === "prj_acme" ? ACME_STATS : PERSONAL_STATS;
  }

  return {
    domains,
    loading,
    forProject,
    sendingFor,
    add,
    remove,
    use,
    recheck,
    lastSavedAt,
    stats,
  };
});

/**
 * The next record the check would find, or the list unchanged once they are all in.
 * Pending before missing, so a fresh domain fills in the order it is read.
 */
function foundNext(records: readonly DnsRecord[]): DnsRecord[] {
  const at = records.findIndex((record) => record.status !== "found");
  if (at === -1) return [...records];
  return records.map((record, index) =>
    index === at ? { ...record, status: "found" as const } : record,
  );
}

/*
 * The placeholder rows.
 */

function sharedDomain(inUse: boolean): SendingDomain {
  return {
    id: "dom_shared",
    domain: SHARED_DOMAIN,
    shared: true,
    status: "verified",
    inUse,
    mailFrom: SHARED_DOMAIN,
    records: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    checkedAt: null,
  };
}

/** The records the provider hands back with a new identity, none of them looked for yet. */
function recordsFor(domain: string, seed: number): DnsRecord[] {
  const next = seeded(seed);
  const bounce = mailFromFor(domain);
  const dkim: DnsRecord[] = [0, 1, 2].map((index) => {
    const token = tokenFrom(next);
    return {
      id: `dkim-${index}`,
      kind: "dkim",
      host: `${token}._domainkey.${domain}`,
      type: "CNAME",
      value: `${token}.dkim.amazonses.com`,
      status: "pending",
    };
  });
  return [
    ...dkim,
    {
      id: "mail-from-mx",
      kind: "mail_from_mx",
      host: bounce,
      type: "MX",
      value: FEEDBACK_HOST,
      priority: 10,
      status: "pending",
    },
    {
      id: "spf",
      kind: "spf",
      host: bounce,
      type: "TXT",
      value: "v=spf1 include:amazonses.com ~all",
      status: "pending",
    },
    {
      id: "dmarc",
      kind: "dmarc",
      host: `_dmarc.${domain}`,
      type: "TXT",
      value: `v=DMARC1; p=reject; rua=mailto:dmarc@${domain}`,
      status: "pending",
    },
  ];
}

function verifyingDomain(domain: string, seed = Date.now() % 9973): SendingDomain {
  return {
    id: `dom_${domain.replace(/[^a-z0-9]/g, "_")}`,
    domain,
    shared: false,
    status: "verifying",
    inUse: false,
    mailFrom: mailFromFor(domain),
    records: recordsFor(domain, seed),
    addedAt: new Date().toISOString(),
    checkedAt: null,
  };
}

/** Every record in, which is what a verified domain's row looks like. */
function allFound(records: readonly DnsRecord[]): DnsRecord[] {
  return records.map((record) => ({ ...record, status: "found" as const }));
}

function personalDomains(): SendingDomain[] {
  return [sharedDomain(true)];
}

function acmeDomains(): SendingDomain[] {
  const verified: SendingDomain = {
    ...verifyingDomain("acme.com", 41),
    status: "verified",
    inUse: true,
    records: allFound(recordsFor("acme.com", 41)),
    addedAt: "2026-07-12T09:20:00.000Z",
    checkedAt: "2026-09-09T06:00:00.000Z",
  };
  const partial = verifyingDomain("notifications.acme.io", 97);
  return [
    sharedDomain(false),
    verified,
    {
      ...partial,
      records: partial.records.map((record, index) =>
        index < 2 ? { ...record, status: "found" as const } : record,
      ),
      addedAt: "2026-09-08T15:40:00.000Z",
      checkedAt: "2026-09-09T05:55:00.000Z",
    },
  ];
}

/*
 * The figures. Deterministic, so a reload does not redraw a different month.
 */

function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** A DKIM token as the provider writes them: 32 lowercase base-32 characters. */
function tokenFrom(next: () => number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let token = "";
  for (let index = 0; index < 32; index += 1) {
    token += alphabet[Math.floor(next() * alphabet.length)] ?? "a";
  }
  return token;
}

function daily(seed: number, base: number, swing: number): number[] {
  const next = seeded(seed);
  return Array.from({ length: 30 }, () => Math.max(0, Math.round(base + (next() - 0.5) * swing)));
}

/** Totals are summed from the days behind them, so no tile can contradict another. */
function statsFrom(
  sentDaily: number[],
  bouncedDaily: number[],
  complained: number,
  sentToday: number,
  dailyCeiling: number,
): DomainStats {
  const sent = sentDaily.reduce((total, day) => total + day, 0);
  const bounced = bouncedDaily.reduce((total, day) => total + day, 0);
  return {
    sent,
    sentDaily,
    delivered: sent - bounced - complained,
    bounced,
    bouncedDaily,
    complained,
    sentToday,
    dailyCeiling,
  };
}

const PERSONAL_STATS = statsFrom(daily(17, 40, 30), daily(19, 0.3, 2), 0, 31, 2000);
const ACME_STATS = statsFrom(daily(23, 1450, 900), daily(29, 9, 12), 21, 1204, 50000);
