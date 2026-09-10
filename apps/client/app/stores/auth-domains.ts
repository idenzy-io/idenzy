/**
 * Each project's custom auth domains, as the panel sees them.
 *
 * Rows of `project_domains` with `type = 'auth'`, read and written through the management
 * API; this store is those rows with a placeholder until the client exists. Its own store
 * rather than a view over the sending-domains one, for the same reason the models are
 * separate: the records, the verification and the failure are all different, and the only
 * thing the two halves of the table share is that a hostname belongs to one project.
 *
 * Adding never writes a verified row. The row arrives pending with its records minted by
 * us, and it becomes verified when a DNS check sees them, which is the server's to decide
 * and never this screen's. A panel that flipped the status itself would report a domain as
 * live while `resolve_project_by_host` still refused every request to it.
 */

import {
  type AuthDomain,
  type AuthDomainStatus,
  normalizeDomain,
  recordsFor,
} from "~/utils/auth-domains";

const PLACEHOLDER_LATENCY = 700;
const WRITE_LATENCY = 700;
/** How long the placeholder pretends a DNS check takes to see a published record. */
const VERIFY_LATENCY = 6000;

export const useAuthDomainsStore = defineStore("auth-domains", () => {
  const domains = ref<Record<string, AuthDomain[]>>({});
  const loading = ref(true);
  const lastChanged = ref<Record<string, string>>({});

  setTimeout(() => {
    domains.value = {
      prj_personal: [],
      prj_acme: [
        {
          id: "dom_1",
          domain: "auth.acme.example",
          status: "verified",
          records: [
            {
              kind: "cname",
              name: "auth.acme.example",
              value: "edge.idenzy.io",
              status: "found",
            },
            {
              kind: "cert",
              name: "_acme-challenge.auth.acme.example",
              value: "9f2c41a8-3e7b.authorize.certificatemanager.goog",
              status: "found",
            },
          ],
          createdAt: "2026-08-14T10:22:00.000Z",
          checkedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
        },
      ],
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): AuthDomain[] {
    return domains.value[projectId] ?? [];
  }

  /**
   * Adds a hostname, pending.
   *
   * The token in the certificate record is minted here only because there is no server to
   * mint it yet. Everything about a record's value belongs to whatever created the
   * identity, and a screen that computed one would show a plausible value that does not
   * exist, which a customer would paste into DNS and wait on for a check that can never
   * pass.
   */
  async function add(projectId: string, domain: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, WRITE_LATENCY));
    const name = normalizeDomain(domain);
    const token = Math.random().toString(16).slice(2, 10);
    const row: AuthDomain = {
      id: `dom_${Date.now()}`,
      domain: name,
      status: "verifying",
      records: recordsFor(name, token),
      createdAt: new Date().toISOString(),
      checkedAt: null,
    };
    domains.value = { ...domains.value, [projectId]: [...forProject(projectId), row] };
    touch(projectId);
    setTimeout(() => settle(projectId, row.id), VERIFY_LATENCY);
  }

  /** The placeholder's stand-in for a DNS check having run and found both records. */
  function settle(projectId: string, id: string) {
    replace(projectId, id, (row) => ({
      ...row,
      status: "verified",
      records: row.records.map((record) => ({ ...record, status: "found" as const })),
      checkedAt: new Date().toISOString(),
    }));
  }

  /**
   * Asks for the records to be looked at again.
   *
   * Offered because the alternative is a customer publishing a record and waiting on a
   * schedule they cannot see. It changes nothing about what is true, only when we look.
   */
  async function recheck(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, WRITE_LATENCY));
    const row = forProject(projectId).find((held) => held.id === id);
    if (row === undefined) return;
    if (row.status === "verified") {
      replace(projectId, id, (held) => ({ ...held, checkedAt: new Date().toISOString() }));
      return;
    }
    settle(projectId, id);
    touch(projectId);
  }

  /**
   * Removes a domain, which takes the host off the air.
   *
   * A delete rather than a disable: the row is what `resolve_project_by_host` reads, and a
   * disabled row that still held the hostname would keep it claimed against every other
   * project while serving nobody.
   */
  async function remove(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, WRITE_LATENCY));
    domains.value = {
      ...domains.value,
      [projectId]: forProject(projectId).filter((row) => row.id !== id),
    };
    touch(projectId);
  }

  function replace(projectId: string, id: string, change: (row: AuthDomain) => AuthDomain) {
    const rows = forProject(projectId);
    const at = rows.findIndex((row) => row.id === id);
    if (at === -1) return;
    const next = [...rows];
    next[at] = change(rows[at] as AuthDomain);
    domains.value = { ...domains.value, [projectId]: next };
  }

  function touch(projectId: string) {
    lastChanged.value = { ...lastChanged.value, [projectId]: new Date().toISOString() };
  }

  function lastChangedAt(projectId: string): string | null {
    return lastChanged.value[projectId] ?? null;
  }

  /** Whether cookie mode can work, which is the one thing the whole screen decides. */
  function statusFor(projectId: string): AuthDomainStatus | null {
    const rows = forProject(projectId);
    if (rows.length === 0) return null;
    return rows.find((row) => row.status === "verified")?.status ?? rows[0]?.status ?? null;
  }

  return { domains, loading, forProject, add, recheck, remove, lastChangedAt, statusFor };
});
