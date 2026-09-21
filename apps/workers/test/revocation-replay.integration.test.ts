import { RevocationSet } from "@idenzy/cache/revocation-set";
import { Logger } from "@idenzy/core/logging/logger";
import { SystemClock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { RevocationEventReader } from "@idenzy/persistence/repository/revocation-event-reader";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RevocationReconciler } from "../src/revocation-reconciler.js";
import { FakeCommands } from "./fakes.js";

const harness = new PostgresHarness();
const ONE = "11111111-1111-1111-1111-111111111111";
const TWO = "22222222-2222-2222-2222-222222222222";
const SESSION = "33333333-3333-3333-3333-333333333333";
const USER = "44444444-4444-4444-4444-444444444444";
const RETENTION = 360;

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

const clock = new SystemClock();
let reader: RevocationEventReader;
let commands: FakeCommands;
let set: RevocationSet;

beforeAll(async () => {
  await harness.start();
  reader = new RevocationEventReader(harness.db);

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  for (const projectId of [ONE, TWO]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
      [projectId, rows[0]?.id],
    );
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.owner.query("DELETE FROM outbox");
  commands = new FakeCommands();
  set = new RevocationSet(commands, clock, RETENTION);
});

async function enqueue(
  projectId: string,
  topic: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<void> {
  await harness.owner.query(`INSERT INTO outbox (project_id, topic, payload) VALUES ($1, $2, $3)`, [
    projectId,
    topic,
    JSON.stringify(payload),
  ]);
}

function reconciler(): RevocationReconciler {
  return new RevocationReconciler(reader, set, clock, new SilentLogger(), {
    retentionSeconds: RETENTION,
  });
}

describe("reading revocation events across tenants", () => {
  /**
   * The whole reason the function exists. A relay serves every project, and RLS is keyed on
   * a project id it does not have, so under tenant scope this read correctly returns nothing.
   */
  it("sees every project, which a tenant-scoped read never could", async () => {
    await enqueue(ONE, "session.revoked", { sessionIds: [SESSION], scope: "current" });
    await enqueue(TWO, "session.revoked", { sessionIds: [SESSION], scope: "current" });

    const events = await reader.since(new Date(Date.now() - 60_000));

    expect(events.map((event) => event.projectId).sort()).toEqual([ONE, TWO]);
  });

  /**
   * A SECURITY DEFINER function that crossed tenants for anything it was asked would be a
   * way to read every event any project has ever emitted. This one returns two topics.
   */
  it("returns revocations and nothing else, whatever else is in the outbox", async () => {
    await enqueue(ONE, "session.created", { sessionId: SESSION });
    await enqueue(ONE, "user.password_changed", { userId: USER });
    await enqueue(ONE, "session.revoked", { sessionIds: [SESSION], scope: "current" });
    await enqueue(ONE, "security.refresh_token_reused", { sessionId: SESSION });

    const events = await reader.since(new Date(Date.now() - 60_000));

    expect(events.map((event) => event.topic).sort()).toEqual([
      "security.refresh_token_reused",
      "session.revoked",
    ]);
  });

  it("ignores anything older than the window it was asked for", async () => {
    await enqueue(ONE, "session.revoked", { sessionIds: [SESSION], scope: "current" });

    const events = await reader.since(new Date(Date.now() + 60_000));

    expect(events).toEqual([]);
  });
});

describe("replaying them", () => {
  /**
   * Valkey is a cache, so a restart empties every project's set and the published snapshot
   * starts telling every customer that nothing is revoked. This is what puts it back, and it
   * is the reason the reconciler exists rather than a nicety on top of the direct write.
   */
  it("rebuilds a set that was lost with the cache it lived in", async () => {
    const at = new Date();
    await enqueue(ONE, "session.revoked", {
      sessionIds: [SESSION],
      scope: "current",
      at: at.toISOString(),
    });

    await reconciler().sweep();

    const snapshot = await set.snapshot(ONE);
    expect(snapshot.sessions).toEqual([PublicId.encode(IdPrefix.Session, SESSION).value]);
  });

  it("keeps one project's revocations out of another's set", async () => {
    await enqueue(TWO, "session.revoked", {
      sessionIds: [SESSION],
      scope: "current",
      at: new Date().toISOString(),
    });

    await reconciler().sweep();

    expect((await set.snapshot(ONE)).sessions).toEqual([]);
    expect((await set.snapshot(TWO)).sessions).toHaveLength(1);
  });

  it("replays a sign-out-everywhere as the watermark the auth API would have written", async () => {
    await enqueue(ONE, "session.revoked", {
      userId: USER,
      sessionIds: [SESSION, "55555555-5555-5555-5555-555555555555"],
      scope: "all",
      at: new Date().toISOString(),
    });

    await reconciler().sweep();

    const snapshot = await set.snapshot(ONE);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.users).toHaveLength(1);
    expect(snapshot.users[0]?.userId).toBe(PublicId.encode(IdPrefix.User, USER).value);
  });
});
