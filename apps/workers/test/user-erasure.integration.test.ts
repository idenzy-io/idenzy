import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { AuditEventReader } from "@idenzy/persistence/repository/audit-event-reader";
import { ErasedUserCopies } from "@idenzy/persistence/repository/erased-user-copies";
import { RelayOffsetRepository } from "@idenzy/persistence/repository/relay-offset-repository";
import { PERSONAL_EVENT_FIELDS } from "@idenzy/protocol/schemas/webhooks";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { messagingTarget, UserErasureRelay } from "../src/user-erasure-relay.js";

/**
 * The messaging half of an erasure, against a real Postgres: outbox events and webhook
 * deliveries that carried an erased user's address lose it, and nothing else does.
 *
 * The statements match on JSON paths behind partial indexes, which is exactly the kind of thing
 * a fake would agree with whatever it was told, so this runs them.
 */

const harness = new PostgresHarness();
const ORG = "44444444-4444-4444-4444-444444444444";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";
const WEBHOOK = "55555555-5555-4555-8555-555555555555";
const ERASED = "aaaaaaaa-0000-4000-8000-000000000001";
const KEPT = "bbbbbbbb-0000-4000-8000-000000000002";
const publicOf = (uuid: string): string => `usr_${uuid.replaceAll("-", "")}`;

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

/** Ten minutes on, so every event written now has settled. */
class LaterClock extends Clock {
  override now(): Date {
    return new Date(Date.now() + 600_000);
  }
}

async function enqueue(projectId: string, topic: string, payload: Record<string, unknown>) {
  await harness.owner.query(
    `INSERT INTO outbox (project_id, topic, payload) VALUES ($1, $2, $3::jsonb)`,
    [projectId, topic, JSON.stringify(payload)],
  );
}

async function deliver(sequence: number, payload: Record<string, unknown> | null) {
  await harness.owner.query(
    `INSERT INTO webhook_deliveries (project_id, webhook_id, event, sequence, payload, attempt_log)
     VALUES ($1, $2, 'session.created', $3, $4::jsonb, '[{"excerpt":"hello ada"}]')`,
    [PROJECT, WEBHOOK, sequence, payload === null ? null : JSON.stringify(payload)],
  );
}

async function payloads(topic: string, userId: string): Promise<Record<string, unknown>[]> {
  const rows = await harness.owner.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM outbox WHERE topic = $1 AND payload->>'userId' = $2 ORDER BY seq`,
    [topic, userId],
  );
  return rows.rows.map((row) => row.payload);
}

beforeAll(async () => {
  await harness.start();
  await harness.owner.query(`INSERT INTO orgs (id, name) VALUES ($1, 'Acme')`, [ORG]);
  for (const project of [PROJECT, OTHER]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'p', 'k')`,
      [project, ORG],
    );
  }
  await harness.owner.query(
    `INSERT INTO webhooks (id, project_id, url, secret_ciphertext)
     VALUES ($1, $2, 'https://hooks.example.test', 'ciphertext')`,
    [WEBHOOK, PROJECT],
  );

  const signedIn = { ip: "203.0.113.11", userAgent: "Mozilla/5.0", amr: ["magic_link"] };
  await enqueue(PROJECT, "user.created", { userId: ERASED, email: "ada@example.test" });
  await enqueue(PROJECT, "session.created", { userId: ERASED, sessionId: "s1", ...signedIn });
  await enqueue(PROJECT, "audit.recorded", { actorId: ERASED, userId: ERASED, ...signedIn });
  await enqueue(PROJECT, "session.created", { userId: KEPT, sessionId: "s2", ...signedIn });
  await enqueue(OTHER, "session.created", { userId: ERASED, sessionId: "s3", ...signedIn });
  await deliver(1, { user: publicOf(ERASED), ip: "203.0.113.11", userAgent: "Mozilla/5.0" });
  await deliver(2, { user: publicOf(KEPT), ip: "203.0.113.11", userAgent: "Mozilla/5.0" });
  await deliver(3, null);
  // The erasure itself, as the API writes it.
  await enqueue(PROJECT, "user.deleted", { userId: ERASED, at: new Date().toISOString() });
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("the messaging half of an erasure", () => {
  it("strips the address from the erased user's events and keeps everything else", async () => {
    const relay = new UserErasureRelay(
      new AuditEventReader(harness.db),
      new RelayOffsetRepository(harness.db),
      [
        messagingTarget(
          (users) => new ErasedUserCopies(harness.db).strip(users, PERSONAL_EVENT_FIELDS),
          new LaterClock(),
        ),
      ],
      new SilentLogger(),
    );
    expect(await relay.sweep()).toBe(1);

    const [created] = await payloads("user.created", ERASED);
    expect(created).toEqual({ userId: ERASED });
    const [session] = await payloads("session.created", ERASED);
    expect(session).toEqual({ userId: ERASED, sessionId: "s1", amr: ["magic_link"] });

    // The trail keeps where its actor acted from, by classification (Art. 17(3)(b)).
    const [audit] = await payloads("audit.recorded", ERASED);
    expect(audit).toMatchObject({ ip: "203.0.113.11" });

    // A neighbour, and the same id under another project, are not this erasure's business.
    const kept = await harness.owner.query(
      `SELECT payload FROM outbox WHERE topic = 'session.created' AND
         (payload->>'userId' = $1 OR project_id = $2)`,
      [KEPT, OTHER],
    );
    for (const row of kept.rows) expect(row.payload).toMatchObject({ ip: "203.0.113.11" });
  });

  it("strips the open deliveries that name the user, and their attempt logs", async () => {
    const rows = await harness.owner.query<{
      sequence: string;
      payload: Record<string, unknown> | null;
      attempt_log: unknown[];
    }>(`SELECT sequence, payload, attempt_log FROM webhook_deliveries ORDER BY sequence`);
    const [erased, kept, delivered] = rows.rows;
    expect(erased?.payload).toEqual({ user: publicOf(ERASED) });
    expect(erased?.attempt_log).toEqual([]);
    expect(kept?.payload).toMatchObject({ ip: "203.0.113.11" });
    expect(kept?.attempt_log).toHaveLength(1);
    expect(delivered?.payload).toBeNull();
  });

  it("has moved past the erasure, so the next pass does nothing", async () => {
    const relay = new UserErasureRelay(
      new AuditEventReader(harness.db),
      new RelayOffsetRepository(harness.db),
      [messagingTarget(() => Promise.reject(new Error("must not be called")), new LaterClock())],
      new SilentLogger(),
    );
    expect(await relay.sweep()).toBe(0);
  });
});
