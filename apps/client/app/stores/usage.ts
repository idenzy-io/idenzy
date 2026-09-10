/**
 * What each project has used in the calendar month being billed (`usage_daily`).
 *
 * The month is the period because that is what MAU means: a user active in it is counted
 * once, whatever they did. Everything else on the row is a daily counter that adds up
 * across it.
 *
 * The logging meter reads zero on every project, because logging is not shipped. It is
 * here rather than absent so the screen can carry the row and the reader can see the line
 * that is coming before it arrives on an invoice.
 *
 * A placeholder until the management client exists, like every store here.
 */

import type { UsagePeriod } from "~/utils/usage";

const PLACEHOLDER_LATENCY = 700;

export const useUsageStore = defineStore("usage", () => {
  const periods = ref<Record<string, UsagePeriod>>({});
  const loading = ref(true);

  setTimeout(() => {
    periods.value = {
      prj_personal: monthFor({ seed: 5, mau: 1_800, emails: 90, sms: 0, domains: 0, byoSms: true }),
      prj_acme: monthFor({
        seed: 17,
        mau: 62_400,
        emails: 1_450,
        sms: 620,
        domains: 1,
        byoSms: true,
      }),
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): UsagePeriod {
    return periods.value[projectId] ?? EMPTY;
  }

  return { periods, loading, forProject };
});

/*
 * The placeholder month. Deterministic, so a reload shows the same bill.
 */

function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface Shape {
  seed: number;
  /** Active users by the end of the month so far. */
  mau: number;
  /** Emails on an average day. */
  emails: number;
  /** Messages on an average day. */
  sms: number;
  domains: number;
  byoSms: boolean;
}

/** The calendar month to date: the first to today, one entry a day. */
function monthFor(shape: Shape): UsagePeriod {
  const next = seeded(shape.seed);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const elapsed = now.getDate();

  const days: string[] = [];
  const mau: number[] = [];
  const emails: number[] = [];
  const sms: number[] = [];
  const smsCost: number[] = [];
  const logBytes: number[] = [];

  for (let index = 0; index < elapsed; index += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    days.push(day.toISOString());

    /* Active users only ever climb through a month: the count is distinct users since the
       first, so a quiet day adds nobody rather than taking anybody away. */
    const share = (index + 1) / elapsed;
    mau.push(Math.round(shape.mau * (0.35 + 0.65 * share) * (0.98 + next() * 0.04)));

    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const rhythm = weekend ? 0.55 : 1;
    emails.push(Math.round(shape.emails * rhythm * (0.7 + next() * 0.6)));
    const sent = Math.round(shape.sms * rhythm * (0.7 + next() * 0.6));
    sms.push(sent);
    /* Roughly two cents a message blended across the destinations this project reaches,
       which is what the routing table would actually have charged. */
    smsCost.push(Math.round(sent * 0.021 * 100) / 100);

    /* Nothing yet: logging is not shipped, and a placeholder that invented volume would
       put a figure on the one line nobody can check. */
    logBytes.push(0);
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    days,
    mau,
    emails,
    sms,
    smsCost,
    logBytes,
    customDomains: shape.domains,
    byoEmail: false,
    byoSms: shape.byoSms,
  };
}

const EMPTY: UsagePeriod = {
  start: new Date().toISOString(),
  end: new Date().toISOString(),
  days: [],
  mau: [],
  emails: [],
  sms: [],
  smsCost: [],
  logBytes: [],
  customDomains: 0,
  byoEmail: false,
  byoSms: false,
};
