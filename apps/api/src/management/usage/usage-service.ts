import { ValidationFailedError } from "@idenzy/core/errors";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { UsageHourlyRepository } from "@idenzy/persistence/repository/usage-hourly-repository";
import { UsagePeriodRepository } from "@idenzy/persistence/repository/usage-period-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { type Transaction, UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type {
  ProjectUsage,
  ProjectUsageHours,
  UsageDay,
  UsagePeriod,
  UsageQuery,
} from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/** A leap year of daily rows. Past that the answer belongs to the analytics store. */
const MAX_WINDOW_DAYS = 366;

/**
 * A month of hours, which is 744 rows.
 *
 * Tighter than the daily cap because the rows are twenty-four times as dense and the question is
 * different: an hourly series is what somebody watching today looks at, and a month of it is
 * already past the point where a chart can draw a point per bucket.
 */
const MAX_HOUR_WINDOW_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERIODS = 7;

/** `YYYY-MM-DD` in UTC, which is what the `day` column stores and what the window is given in. */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** The calendar month `back` months before the one `now` falls in, as its first and last day. */
function monthBefore(now: Date, back: number): UsageWindow {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 0);
  return { from: utcDay(new Date(start)), to: utcDay(new Date(end)) };
}

function monthStartOf(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function monthEndOf(day: string): string {
  const start = new Date(`${monthStartOf(day)}T00:00:00.000Z`);
  return utcDay(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)));
}

export interface UsageWindow {
  readonly from: string;
  readonly to: string;
}

/**
 * What a project used, and what its bill is made of (PROJECT.md 5.1).
 *
 * The whole reason this is a service and not a `SELECT` the panel could have made itself is the
 * active-user figure. It is a HyperLogLog sketch per day, so it is not additive: two days of a
 * hundred may be a hundred people or two hundred, and no arithmetic over the daily numbers
 * recovers which. The union has to happen where the bytes are, which is here.
 *
 * Two questions, deliberately answered by two methods, because only one of them has a defensible
 * answer for an arbitrary span of dates. **A period's figure** is what the bill rests on and a
 * period is always a calendar month, so `periods` is the authority for it. **A day's series** is
 * what a chart draws, and `forProject` serves it over any window — but the level it carries is
 * always the running total within that day's *billing period*, never within the window, because a
 * customer looking at the last seven days wants to know what they owe rather than what seven days
 * would have cost in isolation. That is why the read is widened to whole months and narrowed again
 * afterwards: the 7th of the month cannot be told from the 1st through the 6th.
 *
 * Everything else on the row is an ordinary counter and does add up.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
  ) {}

  /**
   * The window to read, defaulted and bounded.
   *
   * The default is the calendar month in progress rather than a rolling thirty days, because the
   * free tier and the invoice both reset on the 1st and a screen showing anything else would
   * disagree with the bill. The cap is applied here rather than in the schema because a caller
   * who gives one end and lets us default the other is the case that gets long: `from=2020-01-01`
   * with no `to` is five years of rows and passes every field-level check there is.
   */
  static windowOf(query: UsageQuery, now: Date): UsageWindow {
    const window = UsageService.resolve(query, now);
    UsageService.assertWithin(window, MAX_WINDOW_DAYS, "That usage window is longer than a year.");
    return window;
  }

  async forProject(
    context: OrgContext,
    projectId: string,
    { from, to }: UsageWindow,
  ): Promise<ProjectUsage> {
    const tenant = await this.scope.of(context, projectId);
    // Widened to whole months and narrowed again below. A running level restarted at the window's
    // own first day would tell a customer what the last seven days would have cost on their own,
    // which is not a number anybody is charged.
    const rows = await this.uow.transaction((tx) =>
      new UsageRepository(tx, tenant).dailyBetween(monthStartOf(from), monthEndOf(to)),
    );

    // One running sketch per billing period, so `activeUsersToDate` is a real distinct count at
    // each point and not a cumulative sum of numbers that double-count everybody who came back.
    // A closed period has no sketches left, and the two frozen integers stand in for them.
    let running = HyperLogLog.empty();
    let month = "";
    const days: UsageDay[] = [];
    for (const row of rows) {
      if (row.day.slice(0, 7) !== month) {
        month = row.day.slice(0, 7);
        running = HyperLogLog.empty();
      }
      running.mergeFrom(row.activeUsers);
      if (row.day < from || row.day > to) continue;
      days.push({
        day: row.day,
        activeUsers: row.mau ?? row.activeUsers.count,
        activeUsersToDate: row.mauToDate ?? running.count,
        emailsSent: row.emailsSent,
        smsSent: row.smsSent,
        smsVerified: row.smsVerified,
        smsCost: row.smsCost,
      });
    }

    return { from, to, days };
  }

  /**
   * The billing periods behind a project, newest first.
   *
   * Two sources and the response says which: a closed month is read from `usage_periods`, where it
   * was written once and can no longer change, and anything not yet closed is computed live from
   * the daily rows. A month that ended a few hours ago is in the second group, which is the honest
   * answer — the closer waits for the meters, and nothing has been committed yet.
   */
  async periods(context: OrgContext, projectId: string, limit: number): Promise<UsagePeriod[]> {
    const tenant = await this.scope.of(context, projectId);
    const now = new Date();
    const months = Array.from({ length: limit }, (_, back) => monthBefore(now, back));
    const oldest = months.at(-1);
    if (oldest === undefined) return [];

    return await this.uow.transaction(async (tx) => {
      const closed = new Map(
        (
          await new UsagePeriodRepository(tx, tenant).between(
            oldest.from,
            months[0]?.from ?? oldest.from,
          )
        ).map((row) => [row.period, row]),
      );
      const periods: UsagePeriod[] = [];
      for (const month of months) {
        const record = closed.get(month.from);
        periods.push(
          record === undefined
            ? await this.openPeriod(tx, tenant, month)
            : {
                id: month.from.slice(0, 7),
                start: month.from,
                end: month.to,
                closed: true,
                activeUsers: record.activeUsers,
                emailsSent: record.emailsSent,
                smsSent: record.smsSent,
                smsVerified: record.smsVerified,
                smsCost: record.smsCost,
                closedAt: record.closedAt.toISOString(),
              },
        );
      }
      return periods;
    });
  }

  /** A month nobody has shut yet: the union of its sketches and Postgres's own sums. */
  private async openPeriod(
    tx: Transaction,
    tenant: TenantContext,
    month: UsageWindow,
  ): Promise<UsagePeriod> {
    const usage = new UsageRepository(tx, tenant);
    const rows = await usage.dailyBetween(month.from, month.to);
    const running = HyperLogLog.empty();
    for (const row of rows) running.mergeFrom(row.activeUsers);
    // `totalsBetween` and not a fold over the rows: `smsCost` is a six-place decimal and summing
    // a month of them through a float is how a screen stops agreeing with an invoice.
    const totals = await usage.totalsBetween(month.from, month.to);
    return {
      id: month.from.slice(0, 7),
      start: month.from,
      end: month.to,
      closed: false,
      activeUsers: rows.at(-1)?.mauToDate ?? running.count,
      ...totals,
      closedAt: null,
    };
  }

  /**
   * The hourly series over a window of whole days.
   *
   * Asked in days rather than in hours because that is how the rows are found and how the daily
   * twin is asked, and because an hour is a bucket rather than a boundary a caller picks: the
   * roller writes one when it ends, so a window of "the last 24 hours" is two calendar days on
   * this side and a slice on the reader's.
   *
   * There is no running level to recompute here. An hour carries the one it was written with, and
   * that is the only one there is — the sketches it came from are the day's, and a level cannot be
   * reconstructed after the fact from anything else.
   */
  async hoursFor(
    context: OrgContext,
    projectId: string,
    { from, to }: UsageWindow,
  ): Promise<ProjectUsageHours> {
    const tenant = await this.scope.of(context, projectId);
    const rows = await this.uow.transaction((tx) =>
      new UsageHourlyRepository(tx, tenant).between(
        new Date(`${from}T00:00:00.000Z`),
        new Date(`${to}T23:00:00.000Z`),
      ),
    );
    return {
      from,
      to,
      hours: rows.map((row) => ({
        hour: row.hour.toISOString(),
        activeUsersToDate: row.mauToDate,
        emailsSent: row.emailsSent,
        smsSent: row.smsSent,
        smsVerified: row.smsVerified,
        smsCost: row.smsCost,
      })),
    };
  }

  /** The same defaulting as `windowOf`, with the tighter cap an hourly answer carries. */
  static hourWindowOf(query: UsageQuery, now: Date): UsageWindow {
    const window = UsageService.resolve(query, now);
    UsageService.assertWithin(
      window,
      MAX_HOUR_WINDOW_DAYS,
      "That hourly window is longer than a month.",
    );
    return window;
  }

  static periodCountOf(limit: number | undefined): number {
    return limit ?? DEFAULT_PERIODS;
  }

  private static resolve(query: UsageQuery, now: Date): UsageWindow {
    const month = {
      from: utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
      to: utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
    };
    return { from: query.from ?? month.from, to: query.to ?? month.to };
  }

  private static assertWithin(window: UsageWindow, maxDays: number, message: string): void {
    const days =
      (Date.parse(`${window.to}T00:00:00Z`) - Date.parse(`${window.from}T00:00:00Z`)) / DAY_MS + 1;
    if (days > maxDays) {
      throw new ValidationFailedError({ message, fields: [{ path: "from", code: "too_big" }] });
    }
  }
}
