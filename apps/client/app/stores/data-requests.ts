/**
 * Each project's data-subject requests (`data_subject_requests`, PROJECT.md 4.13.6).
 *
 * A request is intake plus a worker: the panel logs one, sets the deadline and watches it,
 * and a worker in `apps/workers` executes it against the field lists generated from the
 * schema. So the writes here are the ones an operator makes, and the ones a worker makes
 * are the ones that arrive.
 *
 * The placeholder carries an overdue row on purpose. It is the state the whole screen
 * exists to surface, and a placeholder with nothing late in it would let the one thing
 * that pages somebody go undesigned.
 *
 * A placeholder until the management client exists, like every store here.
 */

import { type DataSubjectRequest, dueFrom, type RequestKind } from "~/utils/data-requests";
import { DURATIONS } from "~/utils/time";

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const useDataRequestsStore = defineStore("data-requests", () => {
  const requests = ref<Record<string, DataSubjectRequest[]>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    requests.value = { prj_personal: [], prj_acme: acmeRequests() };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): DataSubjectRequest[] {
    return requests.value[projectId] ?? [];
  }

  function write(projectId: string, next: DataSubjectRequest[]) {
    requests.value = { ...requests.value, [projectId]: next };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  /**
   * Intake. The deadline is computed here rather than chosen, because it is statutory:
   * a screen that let somebody pick it would be a screen that let somebody move it.
   */
  async function log(
    projectId: string,
    draft: { subjectUserId: string; subjectLabel: string; kind: RequestKind; requestedBy: string },
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const requestedAt = new Date();
    write(projectId, [
      {
        id: `dsr_${randomHex(12)}`,
        subjectUserId: draft.subjectUserId,
        subjectLabel: draft.subjectLabel,
        kind: draft.kind,
        status: "received",
        requestedAt: requestedAt.toISOString(),
        dueAt: dueFrom(requestedAt),
        completedAt: null,
        artifactUri: null,
        requestedBy: draft.requestedBy,
      },
      ...forProject(projectId),
    ]);
  }

  async function start(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(
      projectId,
      forProject(projectId).map((request) =>
        request.id === id ? { ...request, status: "in_progress" } : request,
      ),
    );
  }

  /**
   * What a worker's answer looks like when it lands. An access or portability request
   * finishes with a bundle; an erasure finishes with nothing to hand over, which is the
   * point of it.
   */
  async function complete(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const at = new Date().toISOString();
    write(
      projectId,
      forProject(projectId).map((request) => {
        if (request.id !== id) return request;
        const bundled = request.kind === "access" || request.kind === "portability";
        return {
          ...request,
          status: "completed" as const,
          completedAt: at,
          artifactUri: bundled ? `https://exports.idenzy.io/${request.id}.zip` : null,
        };
      }),
    );
  }

  /** Lawfully refused: manifestly unfounded, or a subject nobody could verify. */
  async function refuse(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const at = new Date().toISOString();
    write(
      projectId,
      forProject(projectId).map((request) =>
        request.id === id ? { ...request, status: "refused", completedAt: at } : request,
      ),
    );
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return { requests, loading, forProject, log, start, complete, refuse, lastSavedAt };
});

/*
 * The placeholder.
 */

function randomHex(bytes: number): string {
  let out = "";
  for (let index = 0; index < bytes * 2; index += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DURATIONS.DAY);
}

interface Seed {
  id: string;
  subject: string;
  kind: RequestKind;
  status: DataSubjectRequest["status"];
  agedDays: number;
  /** Days after it was logged that it finished. Absent while it is still open. */
  closedAfter?: number;
  by: string;
}

const SEEDS: readonly Seed[] = [
  /* The one the screen exists for. Logged five weeks ago and still open. */
  {
    id: "dsr_overdue",
    subject: "j.okafor@example.net",
    kind: "erasure",
    status: "in_progress",
    agedDays: 34,
    by: "Their own account",
  },
  {
    id: "dsr_soon",
    subject: "amelia.hart@example.com",
    kind: "access",
    status: "received",
    agedDays: 26,
    by: "Their own account",
  },
  {
    id: "dsr_open",
    subject: "wei.zhang@example.net",
    kind: "portability",
    status: "in_progress",
    agedDays: 11,
    by: "Ana Rodríguez",
  },
  {
    id: "dsr_fresh",
    subject: "tomas.novak@example.org",
    kind: "rectification",
    status: "received",
    agedDays: 2,
    by: "Support ticket #5120",
  },
  {
    id: "dsr_done_recent",
    subject: "s.mendoza@example.com",
    kind: "access",
    status: "completed",
    agedDays: 12,
    closedAfter: 3,
    by: "Their own account",
  },
  {
    id: "dsr_done_old",
    subject: "l.fontaine@example.fr",
    kind: "erasure",
    status: "completed",
    agedDays: 48,
    closedAfter: 6,
    by: "Their own account",
  },
  {
    id: "dsr_expired",
    subject: "k.andersen@example.dk",
    kind: "portability",
    status: "completed",
    agedDays: 70,
    closedAfter: 4,
    by: "Hasan Musluoglu",
  },
  {
    id: "dsr_refused",
    subject: "unknown@example.com",
    kind: "access",
    status: "refused",
    agedDays: 20,
    closedAfter: 1,
    by: "Web form",
  },
];

function acmeRequests(): DataSubjectRequest[] {
  return SEEDS.map((seed) => {
    const requestedAt = daysAgo(seed.agedDays);
    const completedAt =
      seed.closedAfter === undefined
        ? null
        : new Date(requestedAt.getTime() + seed.closedAfter * DURATIONS.DAY).toISOString();
    const bundled =
      seed.status === "completed" && (seed.kind === "access" || seed.kind === "portability");

    return {
      id: seed.id,
      subjectUserId: `usr_${randomHex(8)}`,
      subjectLabel: seed.subject,
      kind: seed.kind,
      status: seed.status,
      requestedAt: requestedAt.toISOString(),
      dueAt: dueFrom(requestedAt),
      completedAt,
      /* The oldest completed export's bundle has aged out, which is what the thirty-day
         expiry on `artifact_uri` does and the one state a screen never shows otherwise. */
      artifactUri: bundled ? `https://exports.idenzy.io/${seed.id}.zip` : null,
      requestedBy: seed.by,
    };
  });
}
