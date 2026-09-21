import {
  type AttemptOutcome,
  type DeliveryAttemptRecord,
  WebhookDeliveryRepository,
} from "@idenzy/persistence/repository/webhook-delivery-repository";
import { WebhookRepository } from "@idenzy/persistence/repository/webhook-repository";
import {
  statsDay,
  WebhookStatsRepository,
} from "@idenzy/persistence/repository/webhook-stats-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresHarness } from "../src/postgres-harness.js";

/**
 * The webhook pipeline's data layer against a real Postgres (ADR-0012).
 *
 * These are the transitions the dispatcher will race on, and the reason they are integration
 * tests rather than unit tests is that every interesting one is a property of a single SQL
 * statement: a claim that two dispatchers cannot both win, an append that two writers cannot
 * drop, an upsert two of them can increment at once, and a fan-out that is replayable because a
 * unique index says so. None of that is observable with a fake.
 */

const harness = new PostgresHarness();
const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";

let uow: UnitOfWork;

interface Repos {
  readonly endpoints: WebhookRepository;
  readonly deliveries: WebhookDeliveryRepository;
  readonly stats: WebhookStatsRepository;
}

function inTenant<T>(projectId: string, work: (repos: Repos) => Promise<T>): Promise<T> {
  const context = new TenantContext(projectId, "req_test", "customer_staff");
  return uow.transaction((tx) =>
    work({
      endpoints: new WebhookRepository(tx, context),
      deliveries: new WebhookDeliveryRepository(tx, context),
      stats: new WebhookStatsRepository(tx, context),
    }),
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  const orgId = rows[0]?.id;

  for (const projectId of [PROJECT_A, PROJECT_B]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
      [projectId, orgId],
    );
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

let nextSequence = 1;

function newEndpoint(change: Partial<Parameters<WebhookRepository["create"]>[0]> = {}) {
  return {
    url: "https://api.example.com/hooks/idenzy",
    description: "",
    secretCiphertext: "ciphertext-of-whsec_one",
    events: ["session.created"],
    allEvents: false,
    enabled: true,
    ...change,
  };
}

function attempt(change: Partial<DeliveryAttemptRecord> = {}): DeliveryAttemptRecord {
  return {
    n: 1,
    at: new Date().toISOString(),
    status: 200,
    error: null,
    durationMs: 42,
    response: "ok",
    ...change,
  };
}

function outcome(change: Partial<AttemptOutcome> = {}): AttemptOutcome {
  return { attempt: attempt(), status: "delivered", nextAttemptAt: null, ...change };
}

describe("WebhookRepository", () => {
  it("stores the secret as the ciphertext it was handed, and never anything else", async () => {
    const row = await inTenant(PROJECT_A, (repos) => repos.endpoints.create(newEndpoint()));
    expect(row.secretCiphertext).toBe("ciphertext-of-whsec_one");
    expect(row.previousSecretCiphertext).toBeNull();
    expect(row.rolledAt).toBeNull();
  });

  /* The whole point of the flag: an event type that did not exist when somebody chose "everything"
     still reaches them. */
  it("matches an event by subscription or by the all-events flag", async () => {
    await inTenant(PROJECT_A, async (repos) => {
      const chosen = await repos.endpoints.create(
        newEndpoint({ events: ["user.created"], description: "chosen" }),
      );
      const everything = await repos.endpoints.create(
        newEndpoint({ events: [], allEvents: true, description: "everything" }),
      );
      const off = await repos.endpoints.create(
        newEndpoint({ events: ["user.created"], enabled: false, description: "off" }),
      );

      const matched = await repos.endpoints.enabledFor("user.created");
      const ids = matched.map((endpoint) => endpoint.id);
      expect(ids).toContain(chosen.id);
      expect(ids).toContain(everything.id);
      expect(ids).not.toContain(off.id);

      const invented = await repos.endpoints.enabledFor("event.invented.later");
      expect(invented.map((endpoint) => endpoint.id)).toEqual([everything.id]);
    });
  });

  it("never matches another project's endpoints", async () => {
    const mine = await inTenant(PROJECT_A, (repos) =>
      repos.endpoints.create(newEndpoint({ events: ["mfa.enrolled"] })),
    );
    const theirs = await inTenant(PROJECT_B, (repos) => repos.endpoints.enabledFor("mfa.enrolled"));
    expect(theirs.map((endpoint) => endpoint.id)).not.toContain(mine.id);
    expect(await inTenant(PROJECT_B, (repos) => repos.endpoints.findById(mine.id))).toBeNull();
  });

  /* One statement, because the two secrets are one state: the previous ciphertext is read from the
     row being updated rather than passed in, so a caller cannot rotate against a stale copy. */
  it("moves the old secret aside when it rotates, in one statement", async () => {
    const at = new Date();
    const until = new Date(at.getTime() + 86_400_000);
    const rolled = await inTenant(PROJECT_A, async (repos) => {
      const created = await repos.endpoints.create(newEndpoint());
      return await repos.endpoints.rotateSecret(created.id, "ciphertext-of-whsec_two", until, at);
    });
    expect(rolled?.secretCiphertext).toBe("ciphertext-of-whsec_two");
    expect(rolled?.previousSecretCiphertext).toBe("ciphertext-of-whsec_one");
    expect(rolled?.previousSecretUntil?.getTime()).toBe(until.getTime());
    expect(rolled?.rolledAt?.getTime()).toBe(at.getTime());
  });

  it("clears a previous secret only once its window has closed", async () => {
    await inTenant(PROJECT_A, async (repos) => {
      const now = new Date();
      const open = await repos.endpoints.create(newEndpoint({ description: "open window" }));
      const closed = await repos.endpoints.create(newEndpoint({ description: "closed window" }));
      await repos.endpoints.rotateSecret(open.id, "new", new Date(now.getTime() + 3_600_000), now);
      await repos.endpoints.rotateSecret(closed.id, "new", new Date(now.getTime() - 1_000), now);

      const cleared = await repos.endpoints.clearExpiredPreviousSecrets(now);
      expect(cleared).toBe(1);
      expect((await repos.endpoints.findById(open.id))?.previousSecretCiphertext).toBe(
        "ciphertext-of-whsec_one",
      );
      const after = await repos.endpoints.findById(closed.id);
      expect(after?.previousSecretCiphertext).toBeNull();
      expect(after?.previousSecretUntil).toBeNull();
    });
  });

  /* Counted in the database, because two dispatchers concluding two failures at once would both
     read the same number and both write it back. */
  it("counts failures without losing one to a concurrent writer", async () => {
    const created = await inTenant(PROJECT_A, (repos) => repos.endpoints.create(newEndpoint()));
    const counts = await Promise.all(
      [1, 2, 3, 4].map(() =>
        inTenant(PROJECT_A, (repos) => repos.endpoints.countFailure(created.id, new Date())),
      ),
    );
    expect([...counts].sort()).toEqual([1, 2, 3, 4]);
    expect(
      (await inTenant(PROJECT_A, (r) => r.endpoints.findById(created.id)))?.consecutiveFailures,
    ).toBe(4);
  });

  it("clears the run of failures when something lands", async () => {
    await inTenant(PROJECT_A, async (repos) => {
      const created = await repos.endpoints.create(newEndpoint());
      await repos.endpoints.countFailure(created.id, new Date());
      await repos.endpoints.clearFailures(created.id, new Date());
      expect((await repos.endpoints.findById(created.id))?.consecutiveFailures).toBe(0);
    });
  });

  /* Resuming has to clear the counter: an endpoint switched back on at twenty would die again on
     its next failure rather than after twenty more. */
  it("switches off with a reason and clears the breaker on the way back on", async () => {
    await inTenant(PROJECT_A, async (repos) => {
      const created = await repos.endpoints.create(newEndpoint());
      await repos.endpoints.countFailure(created.id, new Date());

      const off = await repos.endpoints.disable(created.id, "failing", new Date());
      expect(off?.enabled).toBe(false);
      expect(off?.disabledReason).toBe("failing");
      expect(off?.disabledBy).toBeNull();

      const on = await repos.endpoints.enable(created.id, new Date());
      expect(on?.enabled).toBe(true);
      expect(on?.disabledAt).toBeNull();
      expect(on?.disabledReason).toBeNull();
      expect(on?.consecutiveFailures).toBe(0);
    });
  });

  it("names who paused it, where a person did", async () => {
    const member = "33333333-3333-3333-3333-333333333333";
    const paused = await inTenant(PROJECT_A, async (repos) => {
      const created = await repos.endpoints.create(newEndpoint());
      return await repos.endpoints.disable(created.id, "paused", new Date(), member);
    });
    expect(paused?.disabledReason).toBe("paused");
    expect(paused?.disabledBy).toBe(member);
  });

  it("takes its deliveries with it when it is removed", async () => {
    await inTenant(PROJECT_A, async (repos) => {
      const created = await repos.endpoints.create(newEndpoint());
      await repos.deliveries.fanOut(
        [
          {
            webhookId: created.id,
            event: "session.created",
            sequence: nextSequence++,
            occurredAt: new Date(),
            payload: { id: "whd" },
          },
        ],
        new Date(),
      );
      expect(await repos.endpoints.remove(created.id)).toBe(true);
      expect(await repos.deliveries.listForEndpoint(created.id)).toEqual([]);
    });
  });
});

describe("WebhookDeliveryRepository", () => {
  async function endpointIn(projectId: string): Promise<string> {
    const created = await inTenant(projectId, (repos) => repos.endpoints.create(newEndpoint()));
    return created.id;
  }

  it("writes one delivery per endpoint in one statement", async () => {
    const first = await endpointIn(PROJECT_A);
    const second = await endpointIn(PROJECT_A);
    const rows = await inTenant(PROJECT_A, (repos) =>
      repos.deliveries.fanOut(
        [first, second].map((webhookId) => ({
          webhookId,
          event: "session.created",
          sequence: nextSequence++,
          occurredAt: new Date(),
          payload: { sessionId: "ses_1" },
        })),
        new Date(),
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "queued")).toBe(true);
    expect(rows.every((row) => row.payload !== null)).toBe(true);
  });

  /* The relay is at-least-once by design: a crash between the fan-out and its watermark replays
     the batch, and the unique index is what makes that harmless. */
  it("is replayable: the same event fanned out twice sends once", async () => {
    const webhookId = await endpointIn(PROJECT_A);
    const sequence = nextSequence++;
    const delivery = {
      webhookId,
      event: "user.created",
      sequence,
      payload: { userId: "usr_1" },
      occurredAt: new Date(),
    };

    const first = await inTenant(PROJECT_A, (r) => r.deliveries.fanOut([delivery], new Date()));
    const again = await inTenant(PROJECT_A, (r) => r.deliveries.fanOut([delivery], new Date()));
    expect(first).toHaveLength(1);
    expect(again).toHaveLength(0);
    expect(await inTenant(PROJECT_A, (r) => r.deliveries.listForEndpoint(webhookId))).toHaveLength(
      1,
    );
  });

  /* At-least-once delivery means two dispatchers can be handed the same delivery. Exactly one of
     them may own it, or the customer gets two calls where our own bookkeeping says one. */
  it("lets exactly one claim win", async () => {
    const webhookId = await endpointIn(PROJECT_A);
    const [created] = await inTenant(PROJECT_A, (repos) =>
      repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "session.created",
            sequence: nextSequence++,
            occurredAt: new Date(),
            payload: { a: 1 },
          },
        ],
        new Date(),
      ),
    );
    const id = created?.id ?? "";

    const claims = await Promise.all(
      [1, 2, 3].map(() => inTenant(PROJECT_A, (r) => r.deliveries.claim(id, new Date()))),
    );
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it("appends an attempt rather than replacing the log", async () => {
    const webhookId = await endpointIn(PROJECT_A);
    const id = await inTenant(PROJECT_A, async (repos) => {
      const [row] = await repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "session.created",
            sequence: nextSequence++,
            payload: { a: 1 },
            occurredAt: new Date(),
          },
        ],
        new Date(),
      );
      return row?.id ?? "";
    });

    const retryAt = new Date(Date.now() + 10_000);
    await inTenant(PROJECT_A, (repos) =>
      repos.deliveries.recordAttempt(id, {
        attempt: attempt({ n: 1, status: 500, response: "nope" }),
        status: "queued",
        nextAttemptAt: retryAt,
      }),
    );
    const after = await inTenant(PROJECT_A, (repos) =>
      repos.deliveries.recordAttempt(id, {
        attempt: attempt({ n: 2, status: null, error: "Timed out after 5s", response: "" }),
        status: "queued",
        nextAttemptAt: retryAt,
      }),
    );

    expect(after?.attemptCount).toBe(2);
    expect(after?.attempts.map((entry) => entry.n)).toEqual([1, 2]);
    expect(after?.attempts[0]?.status).toBe(500);
    expect(after?.attempts[1]?.error).toBe("Timed out after 5s");
    // Still open, so the body it was signed from is still there.
    expect(after?.payload).not.toBeNull();
  });

  /**
   * The cost decision, as a test, and the correction wiring the replay route forced.
   *
   * A delivery that was taken keeps nothing: the largest column names a user and there is nothing
   * left to send it to. A failed one keeps its body until the window drops the row, because that is
   * the body a replay sends — clearing it on either outcome made the replay route impossible to
   * honour, which is a thing you only notice when you write the route (ADR-0012).
   */
  it("clears the payload when a delivery is taken and keeps it when one fails", async () => {
    const webhookId = await endpointIn(PROJECT_A);
    const [failedId, deliveredId] = await inTenant(PROJECT_A, async (repos) => {
      const rows = await repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "session.created",
            sequence: nextSequence++,
            payload: { a: 1 },
            occurredAt: new Date(),
          },
          {
            webhookId,
            event: "session.created",
            sequence: nextSequence++,
            payload: { a: 2 },
            occurredAt: new Date(),
          },
        ],
        new Date(),
      );
      return [rows[0]?.id ?? "", rows[1]?.id ?? ""];
    });

    const failed = await inTenant(PROJECT_A, (repos) =>
      repos.deliveries.recordAttempt(failedId, outcome({ status: "failed" })),
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.payload).not.toBeNull();
    expect(failed?.nextAttemptAt).toBeNull();
    expect(failed?.attempts.at(-1)?.response).toBe("ok");

    const taken = await inTenant(PROJECT_A, (repos) =>
      repos.deliveries.recordAttempt(deliveredId, outcome({ status: "delivered" })),
    );
    expect(taken?.status).toBe("delivered");
    expect(taken?.payload).toBeNull();
    expect(taken?.deliveredAt).not.toBeNull();
  });

  it("records when a delivery landed, from the attempt that landed it", async () => {
    const webhookId = await endpointIn(PROJECT_A);
    const at = new Date("2026-09-13T10:00:00.000Z");
    const landed = await inTenant(PROJECT_A, async (repos) => {
      const [row] = await repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "session.created",
            sequence: nextSequence++,
            payload: { a: 1 },
            occurredAt: new Date(),
          },
        ],
        new Date(),
      );
      return await repos.deliveries.recordAttempt(row?.id ?? "", {
        attempt: attempt({ at: at.toISOString() }),
        status: "delivered",
        nextAttemptAt: null,
      });
    });
    expect(landed?.deliveredAt?.toISOString()).toBe(at.toISOString());
  });

  /* The durable half: a task that never arrived, or a dispatcher that died holding a delivery,
     is recovered by its next-attempt time rather than lost. */
  it("claims what is due and leaves the future alone", async () => {
    const webhookId = await endpointIn(PROJECT_B);
    const now = new Date();
    await inTenant(PROJECT_B, (repos) =>
      repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "user.created",
            sequence: nextSequence++,
            payload: { a: 1 },
            occurredAt: new Date(),
          },
          {
            webhookId,
            event: "user.created",
            sequence: nextSequence++,
            payload: { a: 2 },
            occurredAt: new Date(),
          },
        ],
        new Date(now.getTime() - 1_000),
      ),
    );
    const later = await inTenant(PROJECT_B, (repos) =>
      repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "user.created",
            sequence: nextSequence++,
            payload: { a: 3 },
            occurredAt: new Date(),
          },
        ],
        new Date(now.getTime() + 3_600_000),
      ),
    );

    const claimed = await inTenant(PROJECT_B, (repos) => repos.deliveries.claimDue(now));
    expect(claimed).toHaveLength(2);
    expect(claimed.every((row) => row.status === "delivering")).toBe(true);
    expect(claimed.map((row) => row.id)).not.toContain(later[0]?.id);
  });

  /**
   * Two sweepers must not both take one delivery, and the lease is what stops them.
   *
   * `delivering` is in the due predicate so a dispatcher that died holding a delivery can be
   * recovered — which means the row this statement just claimed would still be due a millisecond
   * later if the claim stamped the current time. It moves `next_attempt_at` a minute out instead.
   * Written after the first version did stamp `now`, which would have called a customer's endpoint
   * twice about one event whenever two sweepers overlapped.
   */
  it("does not hand one delivery to two sweepers", async () => {
    const webhookId = await endpointIn(PROJECT_B);
    const now = new Date();
    await inTenant(PROJECT_B, (repos) =>
      repos.deliveries.fanOut(
        Array.from({ length: 4 }, () => ({
          webhookId,
          event: "session.revoked",
          sequence: nextSequence++,
          occurredAt: new Date(),
          payload: { a: 1 },
        })),
        new Date(now.getTime() - 1_000),
      ),
    );

    const [first, second] = await Promise.all([
      inTenant(PROJECT_B, (repos) => repos.deliveries.claimDue(now)),
      inTenant(PROJECT_B, (repos) => repos.deliveries.claimDue(now)),
    ]);
    const claimed = [...first, ...second].map((row) => row.id);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed).toHaveLength(4);

    // And a claimed delivery is not due again while its lease holds.
    expect(await inTenant(PROJECT_B, (repos) => repos.deliveries.claimDue(now))).toEqual([]);
  });

  /**
   * The single-id form of the sweep, which is what a Cloud Task calls.
   *
   * Being due is part of the predicate rather than something the caller checked a moment ago, because
   * a queue is at-least-once: the duplicate of a task that armed attempt two must not become attempt
   * three an hour early.
   */
  it("claims one delivery by id only while it is actually due", async () => {
    const webhookId = await endpointIn(PROJECT_B);
    const now = new Date();
    const [row] = await inTenant(PROJECT_B, (repos) =>
      repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "user.updated",
            sequence: nextSequence++,
            payload: { a: 1 },
            occurredAt: new Date(),
          },
        ],
        new Date(now.getTime() + 3_600_000),
      ),
    );
    const id = row?.id ?? "";

    expect(await inTenant(PROJECT_B, (repos) => repos.deliveries.claimIfDue(id, now))).toBeNull();

    // One that is due, taken exactly once however many copies of the task arrive.
    const [due] = await inTenant(PROJECT_B, (repos) =>
      repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "user.updated",
            sequence: nextSequence++,
            payload: { a: 2 },
            occurredAt: new Date(),
          },
        ],
        new Date(now.getTime() - 1_000),
      ),
    );
    const dueId = due?.id ?? "";
    const claims = await Promise.all(
      [1, 2, 3].map(() => inTenant(PROJECT_B, (repos) => repos.deliveries.claimIfDue(dueId, now))),
    );
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);

    // And nothing is left to claim while the lease holds, so a late duplicate finds nothing.
    expect(
      await inTenant(PROJECT_B, (repos) => repos.deliveries.claimIfDue(dueId, now)),
    ).toBeNull();
  });

  it("makes a delivery whose dispatcher died claimable once the lease expires", async () => {
    const webhookId = await endpointIn(PROJECT_B);
    const now = new Date();
    const id = await inTenant(PROJECT_B, async (repos) => {
      const [row] = await repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "sms.blocked",
            sequence: nextSequence++,
            payload: { a: 1 },
            occurredAt: new Date(),
          },
        ],
        new Date(now.getTime() - 1_000),
      );
      // Claimed with a lease that has already run out, which is what a crash leaves behind.
      await repos.deliveries.claim(row?.id ?? "", new Date(now.getTime() - 120_000));
      return row?.id ?? "";
    });

    const recovered = await inTenant(PROJECT_B, (repos) => repos.deliveries.claimDue(now));
    expect(recovered.map((row) => row.id)).toContain(id);
  });

  /* What a replay is: the same delivery, due again, with the attempts it already made. */
  it("reopens a failed delivery for one more attempt", async () => {
    const webhookId = await endpointIn(PROJECT_A);
    await inTenant(PROJECT_A, async (repos) => {
      const [row] = await repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "session.created",
            sequence: nextSequence++,
            payload: { a: 1 },
            occurredAt: new Date(),
          },
        ],
        new Date(),
      );
      const id = row?.id ?? "";
      await repos.deliveries.recordAttempt(id, {
        attempt: attempt({ status: 500 }),
        status: "failed",
        nextAttemptAt: null,
      });

      const due = new Date();
      const reopened = await repos.deliveries.reopen(id, due);
      expect(reopened?.status).toBe("queued");
      expect(reopened?.nextAttemptAt?.getTime()).toBe(due.getTime());
      // The same delivery: its attempts are still there and the next one carries on from them.
      expect(reopened?.attemptCount).toBe(1);
      expect(reopened?.payload).toEqual({ a: 1 });
    });
  });

  it("refuses to reopen a delivery that was taken, or one whose body has gone", async () => {
    const webhookId = await endpointIn(PROJECT_A);
    await inTenant(PROJECT_A, async (repos) => {
      const [row] = await repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "session.created",
            sequence: nextSequence++,
            payload: { a: 1 },
            occurredAt: new Date(),
          },
        ],
        new Date(),
      );
      const id = row?.id ?? "";
      // Taken, so there is nothing to send again and the body is gone for that reason.
      await repos.deliveries.recordAttempt(id, outcome({ status: "delivered" }));
      expect(await repos.deliveries.reopen(id, new Date())).toBeNull();
    });
  });

  it("drops finished deliveries past the window and keeps the ones still owed", async () => {
    const webhookId = await endpointIn(PROJECT_B);
    const cutoff = new Date();
    const ids = await inTenant(PROJECT_B, async (repos) => {
      const rows = await repos.deliveries.fanOut(
        [
          {
            webhookId,
            event: "mfa.removed",
            sequence: nextSequence++,
            payload: { a: 1 },
            occurredAt: new Date(),
          },
          {
            webhookId,
            event: "mfa.removed",
            sequence: nextSequence++,
            payload: { a: 2 },
            occurredAt: new Date(),
          },
        ],
        new Date(),
      );
      const [finished, open] = rows;
      await repos.deliveries.recordAttempt(finished?.id ?? "", outcome());
      return { finished: finished?.id ?? "", open: open?.id ?? "" };
    });

    const removed = await inTenant(PROJECT_B, (repos) =>
      repos.deliveries.deleteFinishedBefore(new Date(cutoff.getTime() + 60_000)),
    );
    expect(removed).toBeGreaterThanOrEqual(1);
    await inTenant(PROJECT_B, async (repos) => {
      expect(await repos.deliveries.findById(ids.finished)).toBeNull();
      expect(await repos.deliveries.findById(ids.open)).not.toBeNull();
    });
  });
});

describe("WebhookStatsRepository", () => {
  it("adds to a day and creates it on the first delivery", async () => {
    const endpoint = await inTenant(PROJECT_A, (repos) => repos.endpoints.create(newEndpoint()));
    const at = new Date("2026-09-13T10:00:00.000Z");
    const day = statsDay(at);

    const first = await inTenant(PROJECT_A, (repos) =>
      repos.stats.add(endpoint.id, day, { delivered: 1, attempts: 1, lastDeliveredAt: at }),
    );
    expect(first.delivered).toBe(1);

    const second = await inTenant(PROJECT_A, (repos) =>
      repos.stats.add(endpoint.id, day, { failed: 1, attempts: 3, lastFailedAt: at }),
    );
    expect(second.delivered).toBe(1);
    expect(second.failed).toBe(1);
    expect(second.attempts).toBe(4);
  });

  /* Two dispatchers finishing two deliveries for one endpoint in the same second is the normal
     case, and a read-then-write would lose one of them. */
  it("survives concurrent increments without losing a count", async () => {
    const endpoint = await inTenant(PROJECT_A, (repos) => repos.endpoints.create(newEndpoint()));
    const day = statsDay(new Date("2026-09-14T00:00:00.000Z"));
    await Promise.all(
      Array.from({ length: 8 }, () =>
        inTenant(PROJECT_A, (repos) =>
          repos.stats.add(endpoint.id, day, { delivered: 1, attempts: 1 }),
        ),
      ),
    );
    const [row] = await inTenant(PROJECT_A, (repos) => repos.stats.forEndpoint(endpoint.id, day));
    expect(row?.delivered).toBe(8);
    expect(row?.attempts).toBe(8);
  });

  /* An attempt recorded out of order must not move the last-seen timestamps backwards. */
  it("keeps the later of two last-seen times", async () => {
    const endpoint = await inTenant(PROJECT_A, (repos) => repos.endpoints.create(newEndpoint()));
    const day = statsDay(new Date("2026-09-15T00:00:00.000Z"));
    const later = new Date("2026-09-15T12:00:00.000Z");
    const earlier = new Date("2026-09-15T06:00:00.000Z");

    await inTenant(PROJECT_A, (repos) =>
      repos.stats.add(endpoint.id, day, { delivered: 1, lastDeliveredAt: later }),
    );
    await inTenant(PROJECT_A, (repos) =>
      repos.stats.add(endpoint.id, day, { delivered: 1, lastDeliveredAt: earlier }),
    );
    const [row] = await inTenant(PROJECT_A, (repos) => repos.stats.forEndpoint(endpoint.id, day));
    expect(row?.lastDeliveredAt?.toISOString()).toBe(later.toISOString());
  });

  it("reads a project's own days and nobody else's", async () => {
    const mine = await inTenant(PROJECT_A, (repos) => repos.endpoints.create(newEndpoint()));
    const day = statsDay(new Date("2026-09-16T00:00:00.000Z"));
    await inTenant(PROJECT_A, (repos) => repos.stats.add(mine.id, day, { delivered: 2 }));
    expect(await inTenant(PROJECT_B, (repos) => repos.stats.forProject(day))).toEqual([]);
  });
});
