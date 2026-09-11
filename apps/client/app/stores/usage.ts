/**
 * What each project has used, month by month (`usage_daily`).
 *
 * The open month and the six closed before it, newest first. A closed month is what its
 * invoice was raised from, so the billing store reads its invoices off these rather than
 * keeping a second set of totals to disagree with.
 *
 * The figures run to the last whole hour, which is `updatedAt` and what the screen says
 * they are as of. Nothing is metered for logging, because logging is not shipped, and a
 * placeholder that invented volume would put a figure on the one line nobody can check.
 *
 * Whose account carried SMS follows the SMS providers store: Acme brought its own Twilio
 * account in August, so the months before it are ours and priced, and the two since are
 * billed by Twilio.
 *
 * A placeholder until the management client exists, like every store here.
 */

import type { ByoVendor } from "~/utils/sms-providers";
import type { ChartMeterId, UsagePeriod, UsageWindow } from "~/utils/usage";

const PLACEHOLDER_LATENCY = 700;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Closed months kept beside the open one. */
const HISTORY_MONTHS = 6;

/** One day's figures, as the chart reads them. */
interface DayFigures {
  mau: number;
  /** The level at the end of the day before, or nought on the 1st. */
  mauBefore: number;
  emails: number;
  sms: number;
  /** Hours the figures cover: 24, or fewer on the day still being metered. */
  hours: number;
}

export const useUsageStore = defineStore("usage", () => {
  const periods = ref<Record<string, UsagePeriod[]>>({});
  const loading = ref(true);
  const refreshing = ref(false);
  /** Why the last read failed, or null. Figures already held stay on screen. */
  const error = ref<string | null>(null);
  /** The instant the figures run to: the last whole hour metered. */
  const updatedAt = ref<string | null>(null);

  function read(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        const asOf = new Date(Math.floor(Date.now() / HOUR) * HOUR);
        periods.value = {
          prj_personal: historyFor(PERSONAL, asOf),
          prj_acme: historyFor(ACME, asOf),
        };
        updatedAt.value = asOf.toISOString();
        error.value = null;
        loading.value = false;
        resolve();
      }, PLACEHOLDER_LATENCY);
    });
  }

  void read();

  async function refresh(): Promise<void> {
    refreshing.value = true;
    try {
      await read();
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
    const asOf = updatedAt.value === null ? Date.now() : Date.parse(updatedAt.value);
    const out = new Map<string, Map<number, DayFigures>>();
    for (const [projectId, list] of Object.entries(periods.value)) {
      const days = new Map<number, DayFigures>();
      for (const period of list) {
        period.days.forEach((day, index) => {
          const start = Date.parse(day);
          days.set(start, {
            mau: period.mau[index] ?? 0,
            mauBefore: period.mau[index - 1] ?? 0,
            emails: period.emails[index] ?? 0,
            sms: period.smsSegments[index] ?? 0,
            hours: Math.min(24, Math.floor((asOf - start) / HOUR)),
          });
        });
      }
      out.set(projectId, days);
    }
    return out;
  });

  /**
   * One value per bucket, null where nothing was metered: before the history starts, or
   * past the hour the figures run to. An hour is its day split by the shape of a day, and
   * active users climb through it rather than jumping at midnight.
   */
  function valuesFor(
    projectId: string,
    meter: ChartMeterId,
    window: UsageWindow,
  ): (number | null)[] {
    const days = indexes.value.get(projectId);
    return window.buckets.map((bucket) => {
      const figures = days?.get(Math.floor(bucket / DAY) * DAY);
      if (!figures) return null;
      if (window.granularity === "day") return figures[meter];

      const hour = new Date(bucket).getUTCHours();
      if (hour >= figures.hours) return null;
      const metered = HOUR_WEIGHTS.slice(0, figures.hours);
      const whole = metered.reduce((total, weight) => total + weight, 0);
      if (meter === "mau") {
        const reached = metered.slice(0, hour + 1).reduce((total, weight) => total + weight, 0);
        return Math.round(
          figures.mauBefore + (figures.mau - figures.mauBefore) * (reached / whole),
        );
      }
      return Math.round((figures[meter] * (HOUR_WEIGHTS[hour] ?? 0)) / whole);
    });
  }

  return {
    periods,
    loading,
    refreshing,
    error,
    updatedAt,
    refresh,
    periodsFor,
    forProject,
    valuesFor,
  };
});

/*
 * The placeholder history. Deterministic, so a reload shows the same bill.
 */

/**
 * The shape of a day by UTC hour: quiet overnight, a plateau through the working day, and
 * a peak where a European afternoon overlaps an American morning. The overview's, so the
 * two screens draw the same day.
 */
const HOUR_WEIGHTS = Array.from(
  { length: 24 },
  (_, hour) => 0.22 + 0.78 * Math.max(0, Math.sin(((hour - 3) / 24) * Math.PI)) ** 1.4,
);

function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * How much of a month's active users have been counted by a share of it. Steep early and
 * flat late, because a returning user is counted the first time and never again.
 */
const CURVE = 1.6;
function counted(share: number): number {
  return (1 - Math.exp(-CURVE * share)) / (1 - Math.exp(-CURVE));
}

interface Shape {
  seed: number;
  /** Month-end active users, the oldest closed month first and the open one last. */
  mau: readonly number[];
  /** Emails on an average weekday. */
  emails: number;
  /** Messages on an average weekday. */
  sms: number;
  /** Domains of their own on the project, by month, oldest first. */
  domains: readonly number[];
  /** Whose account carried SMS, by month, oldest first. Null is our routing. */
  smsVendor: readonly (ByoVendor | null)[];
}

const PERSONAL: Shape = {
  seed: 5,
  mau: [1_200, 1_350, 1_420, 1_560, 1_640, 1_720, 1_800],
  emails: 90,
  sms: 0,
  domains: [0, 0, 0, 0, 0, 0, 0],
  smsVendor: [null, null, null, null, null, null, null],
};

/* acme.com was added in July and notifications.acme.io in September, the Twilio account in
   August: the sending-domains and SMS providers stores tell the same story. */
const ACME: Shape = {
  seed: 17,
  mau: [54_200, 56_900, 58_400, 60_100, 61_800, 63_500, 66_000],
  emails: 1_450,
  sms: 620,
  domains: [0, 0, 0, 0, 1, 1, 2],
  smsVendor: [null, null, null, null, null, "twilio", "twilio"],
};

function historyFor(shape: Shape, asOf: Date): UsagePeriod[] {
  return Array.from({ length: HISTORY_MONTHS + 1 }, (_, back) => monthFor(shape, asOf, back));
}

/** A calendar month in UTC, `back` months before the open one. */
function monthFor(shape: Shape, asOf: Date, back: number): UsagePeriod {
  const slot = shape.mau.length - 1 - back;
  const start = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - back, 1);
  const end = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - back + 1, 1);
  const length = Math.round((end - start) / DAY);
  const closed = back > 0;
  const elapsed = closed ? length : Math.min(length, Math.ceil((asOf.getTime() - start) / DAY));
  const vendor = shape.smsVendor[slot] ?? null;
  const target = shape.mau[slot] ?? 0;
  const next = seeded(shape.seed * 100 + back);

  const days: string[] = [];
  const mau: number[] = [];
  const emails: number[] = [];
  const smsMessages: number[] = [];
  const smsSegments: number[] = [];
  const smsCostCents: number[] = [];
  let level = 0;

  for (let index = 0; index < elapsed; index += 1) {
    const dayStart = start + index * DAY;
    /* The day still being metered has only the part of it that has happened. */
    const share = closed ? 1 : Math.min(1, (asOf.getTime() - dayStart) / DAY);
    days.push(new Date(dayStart).toISOString());

    const reached = Math.max(
      level,
      Math.round(target * counted((index + 1) / length) * (0.99 + next() * 0.02)),
    );
    level = Math.round(level + (reached - level) * share);
    mau.push(level);

    const weekday = new Date(dayStart).getUTCDay();
    const rhythm = weekday === 0 || weekday === 6 ? 0.55 : 1;
    emails.push(Math.round(shape.emails * rhythm * (0.75 + next() * 0.5) * share));

    const messages = Math.round(shape.sms * rhythm * (0.7 + next() * 0.6) * share);
    const segments = messages + Math.round(messages * (0.08 + next() * 0.08));
    smsMessages.push(messages);
    smsSegments.push(segments);
    /* Roughly two cents a segment blended across the destinations, which is what the
       routing table would have charged. Nothing of ours on the customer's own account. */
    smsCostCents.push(vendor === null ? Math.round(segments * 2.1) : 0);
  }

  const domains = shape.domains[slot] ?? 0;
  return {
    id: new Date(start).toISOString().slice(0, 7),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    closed,
    days,
    mau,
    emails,
    smsMessages,
    smsSegments,
    smsCostCents,
    customDomains: domains,
    ownDomain: domains > 0,
    byoEmail: false,
    smsVendor: vendor,
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
    smsSegments: [],
    smsCostCents: [],
    customDomains: 0,
    ownDomain: false,
    byoEmail: false,
    smsVendor: null,
  };
}
