/**
 * Each project's audit trail as the panel reads it (`audit_events`, PROJECT.md 4.13.3).
 *
 * Read only, and it will stay that way: the runtime role holds INSERT and SELECT on that
 * table and no UPDATE or DELETE at all, and the insert belongs to the relay because the
 * chain has exactly one writer. There is no write for this store to make.
 *
 * **It reads the newest entries and not the whole trail**, which is the one thing about
 * this store that has to be understood before trusting a number on the screen. A month of
 * a busy project's trail is tens of thousands of entries, so the read is bounded and the
 * screen filters what arrived. `truncated` says when the bound was reached, and the screen
 * says so out loud rather than presenting a partial count as a total — the placeholder
 * this replaces could answer "how many in ninety days" because it had invented all of
 * them, and that is exactly the kind of claim wiring is supposed to take away.
 *
 * The window is the one filter sent to the API, because it is the one that decides which
 * entries exist rather than which of them to show. Everything else narrows what arrived.
 *
 * Names are the server's. The trail stores ids because a name changes and an entry has to
 * keep saying what it said at the time; the API resolves the accounts it can and leaves
 * the rest null, which is the erased account and is a normal row rather than an error.
 */

import { AUDIT_TEAM_ACTORS } from "@idenzy/protocol/enums/compliance";
import type { ProjectAuditEvent, ProjectAuditList } from "@idenzy/protocol/schemas/management";
import type { ActorType, AuditEvent } from "~/utils/audit";
import { type TimeWindow, windowStart } from "~/utils/filters";
import { managementMessage } from "~/utils/sign-in-errors";

/** One read covers a quiet project; past this the screen says what it is showing. */
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

/**
 * The period, the page size and where to continue from.
 *
 * The period is sent and the rest of the screen's filters are not, because this one
 * decides which entries were fetched at all: narrowing and widening a server-paged list
 * are not the same operation over one array.
 */
function queryFor(window: TimeWindow, cursor: string | null): URLSearchParams {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  const from = windowStart(window, new Date());
  if (from !== null) query.set("from", from.toISOString());
  if (cursor !== null) query.set("cursor", cursor);
  return query;
}

export const useAuditStore = defineStore("audit", () => {
  const projects = useProjectStore();

  const byProject = ref<Record<string, AuditEvent[]>>({});
  const truncatedFor = ref<Record<string, boolean>>({});
  const loading = ref(false);
  const refusal = ref<string | null>(null);
  /** Non-reactive on purpose: mutating a ref inside a computed re-invalidates the computed. */
  const requested = new Set<string>();
  let loadedWindow: TimeWindow = "30d";

  function basePath(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/audit`;
  }

  function present(event: ProjectAuditEvent): AuditEvent {
    return {
      id: event.id,
      seq: event.seq,
      createdAt: event.createdAt,
      actorType: event.actorType as ActorType,
      actorId: event.actorId,
      /* The id is the honest fallback here and not a guess: an entry whose account was
         erased has no name to print, and the row still has to read as a sentence. */
      actorName: event.actorName ?? event.actorId ?? "Unknown",
      action: event.action,
      target: event.target,
      targetName: event.targetName,
      ip: event.ip,
      ua: event.ua,
      /* Not a column. The relay writes what the flow put in `meta`, so an entry with no
         request behind it — anything a background job did — simply has none. */
      requestId:
        typeof event.metadata["requestId"] === "string" ? event.metadata["requestId"] : null,
      metadata: event.metadata,
      prevHash: event.prevHash,
      entryHash: event.entryHash,
    };
  }

  async function page(path: string, query: URLSearchParams): Promise<ProjectAuditList> {
    const { data, error } = await useManagementApi()(`${path}?${query.toString()}`)
      .get()
      .json<ProjectAuditList>();
    if (error.value !== null) throw error.value;
    return data.value ?? { events: [], nextCursor: null };
  }

  /**
   * Reads a project's trail for one window, newest first.
   *
   * Every actor kind is asked for, including the project's own users. They are the bulk of
   * the trail and the screen sets them aside by default, but the filter that shows them
   * has to have something to show — leaving them on the server would make that control a
   * lie about what exists rather than a view of it, which is the same call the sessions
   * screen makes about revoked rows.
   */
  async function load(projectId: string, window: TimeWindow = loadedWindow): Promise<void> {
    const path = basePath(projectId);
    if (path === null) return;
    loading.value = true;
    refusal.value = null;
    loadedWindow = window;
    try {
      const collected: AuditEvent[] = [];
      let cursor: string | null = null;
      let truncated = false;
      for (let read = 0; read < MAX_PAGES; read += 1) {
        const answer: ProjectAuditList = await page(path, queryFor(window, cursor));
        collected.push(...answer.events.map(present));
        cursor = answer.nextCursor;
        if (cursor === null) break;
        truncated = read === MAX_PAGES - 1;
      }
      byProject.value = { ...byProject.value, [projectId]: collected };
      truncatedFor.value = { ...truncatedFor.value, [projectId]: truncated };
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  function ensure(projectId: string): void {
    if (requested.has(projectId)) return;
    requested.add(projectId);
    void load(projectId);
  }

  function forProject(projectId: string): AuditEvent[] {
    ensure(projectId);
    return byProject.value[projectId] ?? [];
  }

  /** Whether the bound was reached, so the screen can say what it is counting. */
  function isTruncated(projectId: string): boolean {
    return truncatedFor.value[projectId] === true;
  }

  /**
   * Widens or narrows what is held, for the screen's period control.
   *
   * A re-read rather than a client-side filter, because the period decides which entries
   * were fetched at all: narrowing and widening are not the same operation over one list.
   */
  async function setWindow(projectId: string, window: TimeWindow): Promise<void> {
    if (window === loadedWindow && requested.has(projectId)) return;
    requested.add(projectId);
    await load(projectId, window);
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

  /** The newest entry, which is the chain's tip as far as this read saw it. */
  function tipOf(projectId: string): AuditEvent | null {
    return forProject(projectId).reduce<AuditEvent | null>(
      (tip, event) => (tip === null || event.seq > tip.seq ? event : tip),
      null,
    );
  }

  /** Every actor kind, for the screen's filter menu. The API's vocabulary, not a second one. */
  const teamActors: readonly ActorType[] = AUDIT_TEAM_ACTORS as readonly ActorType[];

  return {
    events: byProject,
    loading,
    refusal,
    forProject,
    forSubject,
    tipOf,
    isTruncated,
    setWindow,
    teamActors,
  };
});
