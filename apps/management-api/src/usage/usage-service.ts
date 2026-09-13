import { ValidationFailedError } from "@idenzy/core/errors";
import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { ProjectUsage, UsageDay, UsageQuery } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/** A leap year of daily rows. Past that the answer belongs to the analytics store. */
const MAX_WINDOW_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in UTC, which is what the `day` column stores and what the window is given in. */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
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
 * recovers which. The union has to happen where the bytes are, which is here, and the running
 * level it produces is the one that reconciles with an invoice.
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
    const month = {
      from: utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
      to: utcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
    };
    const window = { from: query.from ?? month.from, to: query.to ?? month.to };
    const days =
      (Date.parse(`${window.to}T00:00:00Z`) - Date.parse(`${window.from}T00:00:00Z`)) / DAY_MS + 1;
    if (days > MAX_WINDOW_DAYS) {
      throw new ValidationFailedError({
        message: "That usage window is longer than a year.",
        fields: [{ path: "from", code: "too_big" }],
      });
    }
    return window;
  }

  async forProject(
    context: OrgContext,
    projectId: string,
    { from, to }: UsageWindow,
  ): Promise<ProjectUsage> {
    const tenant = await this.scope.of(context, projectId);
    const rows = await this.uow.run(tenant, (tx) =>
      new UsageRepository(tx, tenant).dailyBetween(from, to),
    );

    // One running sketch, unioned day by day, so `activeUsersToDate` is a real distinct count at
    // each point and not a cumulative sum of numbers that double-count everybody who came back.
    const running = HyperLogLog.empty();
    const days: UsageDay[] = rows.map((row) => {
      running.mergeFrom(row.activeUsers);
      return {
        day: row.day,
        activeUsers: row.activeUsers.count,
        activeUsersToDate: running.count,
        emailsSent: row.emailsSent,
        smsSent: row.smsSent,
        smsVerified: row.smsVerified,
        smsCost: row.smsCost,
      };
    });

    return { from, to, activeUsers: running.count, days };
  }
}
