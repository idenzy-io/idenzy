/**
 * The imports a project has run, and the one it is running now.
 *
 * An import is a job on the server: the file goes up, a worker parses it (PROJECT.md
 * 9.6), rows are written through the management API, and the panel polls for progress
 * and the outcome. This store is that job as the panel sees it. Until the management
 * API client exists the file never leaves the browser: `start` takes the analysis the
 * screen already ran, walks a progress figure to the end the way a poll would, and
 * reports the counts the analysis predicted. The shape is the API's, so the wiring is
 * the only thing that changes.
 *
 * Two of the figures are the ones an operator watches after an import. Passwords kept
 * are the rows whose hash we can verify, and passwords upgraded are those accounts
 * that have since signed in and been rehashed to Argon2id, which is the moment the
 * legacy hash is gone. The gap between them is what is still riding on the old format.
 */

import type {
  ImportAnalysis,
  ImportError,
  ImportFormat,
  ImportJob,
  ImportSource,
  Issue,
} from "~/utils/import";
import { BLOCKING_ISSUES, ISSUE_LABELS } from "~/utils/import";
import { DURATIONS } from "~/utils/time";

export interface ImportPlan {
  projectId: string;
  source: ImportSource;
  fileName: string;
  format: ImportFormat;
  dryRun: boolean;
  analysis: ImportAnalysis;
  startedBy: string;
}

export interface ImportMetrics {
  /** Over the last thirty days. */
  usersImported: number;
  imports: number;
  passwordsKept: number;
  passwordsUpgraded: number;
  /** Imported users who have yet to sign in, so their legacy hash is still in use. */
  awaitingUpgrade: number;
  /** Users imported per day over the last thirty days, oldest first. */
  daily: number[];
}

/** How long the placeholder takes to "arrive", and how fast a simulated job runs. */
const PLACEHOLDER_LATENCY = 700;
const TICK = 120;

export const useImportsStore = defineStore("imports", () => {
  const jobs = ref<ImportJob[]>([]);
  const loading = ref(true);
  setTimeout(() => {
    jobs.value = placeholderJobs();
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): ImportJob[] {
    return jobs.value
      .filter((job) => job.projectId === projectId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  /** Starts the job and returns it; the same object is updated as it runs. */
  function start(plan: ImportPlan): ImportJob {
    const job: ImportJob = {
      id: `imp_${Math.random().toString(36).slice(2, 12)}`,
      projectId: plan.projectId,
      source: plan.source,
      fileName: plan.fileName,
      format: plan.format,
      dryRun: plan.dryRun,
      rows: plan.analysis.total,
      imported: 0,
      skipped: 0,
      failed: 0,
      passwordsKept: 0,
      passwordsDropped: 0,
      passwordsUpgraded: 0,
      status: "running",
      progress: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      startedBy: plan.startedBy,
      errors: [],
    };
    jobs.value = [job, ...jobs.value];
    run(job, plan.analysis);
    return job;
  }

  /*
   * The outcome is decided by the analysis and revealed by the clock: the counts climb
   * with the progress figure, so a screen watching the job sees rows land rather than a
   * bar that fills and then a number that appears.
   *
   * The figure is the ticker's own. `patch` replaces the row with a new object, so the
   * one this closure was handed keeps whatever progress it started with: read from it
   * and the bar stalls a tenth of the way along and the job never finishes.
   */
  function run(job: ImportJob, analysis: ImportAnalysis) {
    const outcome = outcomeOf(analysis);
    let done = job.progress;
    const timer = setInterval(() => {
      const progress = Math.min(1, done + 0.05 + Math.random() * 0.12);
      done = progress;
      patch(job.id, {
        progress,
        imported: Math.round(outcome.imported * progress),
        skipped: Math.round(outcome.skipped * progress),
        failed: Math.round(outcome.failed * progress),
        passwordsKept: Math.round(outcome.passwordsKept * progress),
        passwordsDropped: Math.round(outcome.passwordsDropped * progress),
      });
      if (progress >= 1) {
        clearInterval(timer);
        patch(job.id, {
          ...outcome,
          status: "done",
          finishedAt: new Date().toISOString(),
        });
      }
    }, TICK);
  }

  function patch(id: string, change: Partial<ImportJob>) {
    jobs.value = jobs.value.map((job) => (job.id === id ? { ...job, ...change } : job));
  }

  function metrics(projectId: string, now: Date): ImportMetrics {
    const since = now.getTime() - 30 * DURATIONS.DAY;
    const recent = forProject(projectId).filter(
      (job) => job.status === "done" && !job.dryRun && new Date(job.startedAt).getTime() >= since,
    );
    const daily = Array.from({ length: 30 }, () => 0);
    for (const job of recent) {
      const day = Math.floor((new Date(job.startedAt).getTime() - since) / DURATIONS.DAY);
      const at = Math.min(29, Math.max(0, day));
      daily[at] = (daily[at] ?? 0) + job.imported;
    }
    const sum = (pick: (job: ImportJob) => number) =>
      recent.reduce((total, job) => total + pick(job), 0);
    const passwordsKept = sum((job) => job.passwordsKept);
    const passwordsUpgraded = sum((job) => job.passwordsUpgraded);
    return {
      usersImported: sum((job) => job.imported),
      imports: recent.length,
      passwordsKept,
      passwordsUpgraded,
      awaitingUpgrade: passwordsKept - passwordsUpgraded,
      daily,
    };
  }

  return { jobs, loading, forProject, start, metrics };
});

interface Outcome {
  imported: number;
  skipped: number;
  failed: number;
  passwordsKept: number;
  passwordsDropped: number;
  errors: ImportError[];
}

/**
 * What the server will say about this file, from what the analysis found. A duplicate
 * is skipped, the other blocking issues are failures, and every refused row is named
 * in the error list with the reason, the way the server's report names them.
 */
function outcomeOf(analysis: ImportAnalysis): Outcome {
  let skipped = 0;
  let failed = 0;
  const errors: ImportError[] = [];
  for (const row of analysis.rows) {
    const blocking = row.issues.filter((issue) => BLOCKING_ISSUES.includes(issue));
    if (blocking.length === 0) continue;
    if (blocking.includes("duplicate_email")) skipped += 1;
    else failed += 1;
    errors.push({
      line: row.line,
      email: row.email,
      reason: blocking.map((issue: Issue) => ISSUE_LABELS[issue]).join("; "),
    });
  }
  return {
    imported: analysis.importable,
    skipped,
    failed,
    passwordsKept: analysis.passwordsKeptTotal,
    passwordsDropped: analysis.passwordsDropped,
    errors,
  };
}

/*
 * Placeholder history for the second project, so the screen with a past import and the
 * screen without one can both be seen. Replaced wholesale by the management API.
 */
function placeholderJobs(): ImportJob[] {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  return [
    {
      id: "imp_6h2k9v4pq1",
      projectId: "prj_acme",
      source: "firebase",
      fileName: "users-export.json",
      format: "json",
      dryRun: false,
      rows: 1204,
      imported: 1189,
      skipped: 9,
      failed: 6,
      passwordsKept: 1102,
      passwordsDropped: 0,
      passwordsUpgraded: 731,
      status: "done",
      progress: 1,
      startedAt: ago(23 * DURATIONS.DAY + 3 * DURATIONS.HOUR),
      finishedAt: ago(23 * DURATIONS.DAY + 3 * DURATIONS.HOUR - 4 * DURATIONS.MINUTE),
      startedBy: "hasan@example.com",
      errors: [
        { line: 88, email: null, reason: "No email or phone" },
        { line: 412, email: "n.aksoy@", reason: "Email is not an address" },
      ],
    },
    {
      id: "imp_2mx8rt0zab",
      projectId: "prj_acme",
      source: "file",
      fileName: "customers-q3.csv",
      format: "csv",
      dryRun: false,
      rows: 58,
      imported: 55,
      skipped: 0,
      failed: 3,
      passwordsKept: 0,
      passwordsDropped: 12,
      passwordsUpgraded: 0,
      status: "done",
      progress: 1,
      startedAt: ago(4 * DURATIONS.DAY + 5 * DURATIONS.HOUR),
      finishedAt: ago(4 * DURATIONS.DAY + 5 * DURATIONS.HOUR - 20_000),
      startedBy: "hasan@example.com",
      errors: [{ line: 17, email: "sales@acme", reason: "Email is not an address" }],
    },
    {
      id: "imp_9qzt3nw7lc",
      projectId: "prj_acme",
      source: "supabase",
      fileName: "auth_users.csv",
      format: "csv",
      dryRun: true,
      rows: 3310,
      imported: 3298,
      skipped: 12,
      failed: 0,
      passwordsKept: 3010,
      passwordsDropped: 0,
      passwordsUpgraded: 0,
      status: "done",
      progress: 1,
      startedAt: ago(2 * DURATIONS.HOUR),
      finishedAt: ago(2 * DURATIONS.HOUR - 90_000),
      startedBy: "hasan@example.com",
      errors: [],
    },
  ];
}
