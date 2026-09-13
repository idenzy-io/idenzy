/**
 * What each project has used, month by month, read through the management API.
 *
 * The open month and the six behind it, newest first. Two calls and not one, because the two
 * questions have different answers: `usage/periods` is the authority for what a period cost — a
 * closed month is a row that was written once and cannot change — and `usage` is the daily series
 * the chart draws. A window of days cannot be asked what a month cost, because the sketches that
 * could answer are dropped when the month closes.
 *
 * **The series is sparse and the screen is not.** A day nobody used has no row, so every period is
 * filled out here: counters to zero, and active users carried forward. Carried rather than zeroed,
 * because active users are a *level* — a quiet Sunday does not mean nobody was active this month,
 * it means nobody new was.
 *
 * **What the meters do not know is not invented.** `usage_daily` counts what was sent and who was
 * active; it records nothing about which sending domain was used or whose SMS account carried a
 * message, and no endpoint serves that yet. So the sending configuration below is the shared-domain,
 * our-routing case, stated on the screen as an assumption rather than dressed as a reading. That is
 * one of the two things the wiring cost this screen; the other is the hour-by-hour view, which
 * daily rows cannot support and which belongs to the analytics store (todo.md 3.2).
 */

import type { ProjectUsage, UsagePeriodList } from "@idenzy/protocol/schemas/management";
import { managementMessage } from "~/utils/sign-in-errors";
import type { ChartMeterId, UsagePeriod, UsageWindow } from "~/utils/usage";

const DAY = 24 * 3_600_000;

/** Closed months kept beside the open one. */
const HISTORY_MONTHS = 6;

/** One day's figures, as the chart reads them. */
interface DayFigures {
  mau: number;
  emails: number;
  sms: number;
}

export const useUsageStore = defineStore("usage", () => {
  const projects = useProjectStore();

  const periods = ref<Record<string, UsagePeriod[]>>({});
  const loading = ref(false);
  const refreshing = ref(false);
  /** Why the last read failed, or null. Figures already held stay on screen. */
  const error = ref<string | null>(null);
  /** When the figures were read. The meters flush on their own interval behind this. */
  const updatedAt = ref<string | null>(null);

  /** The route every call hangs off. Null when the project's organisation is unknown. */
  function basePath(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/usage`;
  }

  async function load(projectId: string): Promise<void> {
    const path = basePath(projectId);
    if (path === null) return;
    loading.value = true;
    error.value = null;
    try {
      const api = useManagementApi();
      const list = await api(`${path}/periods?limit=${HISTORY_MONTHS + 1}`)
        .get()
        .json<UsagePeriodList>();
      if (list.error.value !== null) throw list.error.value;
      const months = list.data.value?.periods ?? [];

      const oldest = months.at(-1);
      const newest = months[0];
      /* One call for every month's days rather than one per month: seven months is well inside
         the window the endpoint allows, and the running level it returns already restarts at each
         month boundary, so grouping by month here loses nothing. */
      const series =
        oldest === undefined || newest === undefined
          ? []
          : await daysBetween(api, path, oldest.start, newest.end);

      const byDay = new Map(series.map((day) => [day.day, day]));
      periods.value = {
        ...periods.value,
        [projectId]: months.map((month) => assemble(month, byDay)),
      };
      updatedAt.value = new Date().toISOString();
    } catch (cause: unknown) {
      error.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    refreshing.value = true;
    try {
      await load(projects.current.id);
    } finally {
      refreshing.value = false;
    }
  }

  /** Newest first: the open month, then the closed ones. */
  function periodsFor(projectId: string): UsagePeriod[] {
    return periods.value[projectId] ?? [];
  }

  /** The open month. */
  function forProject(projectId: string): UsagePeriod {
    return periodsFor(projectId)[0] ?? emptyMonth(new Date());
  }

  const indexes = computed(() => {
    const out = new Map<string, Map<number, DayFigures>>();
    for (const [projectId, list] of Object.entries(periods.value)) {
      const days = new Map<number, DayFigures>();
      for (const period of list) {
        period.days.forEach((day, index) => {
          days.set(Date.parse(day), {
            mau: period.mau[index] ?? 0,
            emails: period.emails[index] ?? 0,
            sms: period.smsMessages[index] ?? 0,
          });
        });
      }
      out.set(projectId, days);
    }
    return out;
  });

  /**
   * One value per bucket, null where nothing was metered.
   *
   * A bucket is a day and only a day. The meters roll up per day, so an hourly reading would have
   * to be invented from a curve — which is what this did while the figures were fixtures, and is
   * exactly the sort of number a customer would reconcile against and find missing.
   */
  function valuesFor(
    projectId: string,
    meter: ChartMeterId,
    window: UsageWindow,
  ): (number | null)[] {
    const days = indexes.value.get(projectId);
    return window.buckets.map(
      (bucket) => days?.get(Math.floor(bucket / DAY) * DAY)?.[meter] ?? null,
    );
  }

  return {
    periods,
    loading,
    refreshing,
    error,
    updatedAt,
    load,
    refresh,
    periodsFor,
    forProject,
    valuesFor,
  };
});

type DayRow = ProjectUsage["days"][number];
type PeriodRow = UsagePeriodList["periods"][number];

async function daysBetween(
  api: ReturnType<typeof useManagementApi>,
  path: string,
  from: string,
  to: string,
): Promise<DayRow[]> {
  const { data, error } = await api(`${path}?from=${from}&to=${to}`).get().json<ProjectUsage>();
  if (error.value !== null) throw error.value;
  return data.value?.days ?? [];
}

/**
 * A month, filled out day by day from a sparse series.
 *
 * An open period stops at today; a closed one runs to its last day. `mau` carries the level
 * forward through days with no row, and the counters do not: a day with no emails sent is a zero,
 * and a day with nobody new is still every active user the month has had.
 */
function assemble(month: PeriodRow, byDay: Map<string, DayRow>): UsagePeriod {
  const start = Date.parse(`${month.start}T00:00:00.000Z`);
  const last = Date.parse(`${month.end}T00:00:00.000Z`);
  const today = Math.floor(Date.now() / DAY) * DAY;
  const until = month.closed ? last : Math.min(last, today);

  const days: string[] = [];
  const mau: number[] = [];
  const emails: number[] = [];
  const smsMessages: number[] = [];
  const smsVendorCostCents: number[] = [];
  let level = 0;

  for (let at = start; at <= until; at += DAY) {
    const iso = new Date(at).toISOString();
    const row = byDay.get(iso.slice(0, 10));
    days.push(iso);
    level = row === undefined ? level : row.activeUsersToDate;
    mau.push(level);
    emails.push(row?.emailsSent ?? 0);
    smsMessages.push(row?.smsSent ?? 0);
    smsVendorCostCents.push(Math.round(Number(row?.smsCost ?? 0) * 100));
  }

  const lastDay = new Date(last);
  return {
    id: month.id,
    start: new Date(start).toISOString(),
    // Exclusive, which is what the screen's spans and comparisons are written against. The API's
    // `end` is the month's last day, inclusive, because that is what a day window is asked in.
    end: new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth() + 1, 1)).toISOString(),
    closed: month.closed,
    days,
    mau,
    emails,
    smsMessages,
    smsVendorCostCents,
    customDomains: 0,
    ownDomain: false,
    byoEmail: false,
    smsVendor: null,
  };
}

function emptyMonth(now: Date): UsagePeriod {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return {
    id: new Date(start).toISOString().slice(0, 7),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    closed: false,
    days: [],
    mau: [],
    emails: [],
    smsMessages: [],
    smsVendorCostCents: [],
    customDomains: 0,
    ownDomain: false,
    byoEmail: false,
    smsVendor: null,
  };
}
