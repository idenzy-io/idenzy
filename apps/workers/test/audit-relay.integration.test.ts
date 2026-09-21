import { verifyAuditChain } from "@idenzy/compliance/audit/hash-chain";
import { Logger } from "@idenzy/core/logging/logger";
import { SystemClock } from "@idenzy/core/time/clock";
import {
  type AuditChainRow,
  AuditEventReader,
} from "@idenzy/persistence/repository/audit-event-reader";
import { RelayOffsetRepository } from "@idenzy/persistence/repository/relay-offset-repository";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_CONSUMER, AuditRelay } from "../src/audit-relay.js";

const harness = new PostgresHarness();
const PROJECT_ONE = "11111111-1111-1111-1111-111111111111";
const PROJECT_TWO = "22222222-2222-2222-2222-222222222222";
const clock = new SystemClock();

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

let reader: AuditEventReader;
let offsets: RelayOffsetRepository;
let relay: AuditRelay;

/** Enqueues the outbox event `OutboxFlowAudit` writes, at a time we choose. */
async function enqueue(
  projectId: string,
  action: string,
  options: { actorId?: string; at?: Date; createdAt?: Date; meta?: Record<string, unknown> } = {},
): Promise<void> {
  const at = options.at ?? new Date();
  await harness.owner.query(
    `INSERT INTO outbox (project_id, topic, payload, created_at)
     VALUES ($1, 'audit.recorded', $2::jsonb, $3)`,
    [
      projectId,
      JSON.stringify({
        action,
        actorType: "user",
        actorId: options.actorId ?? "usr_1",
        target: null,
        requestId: "req_test",
        ip: "203.0.113.1",
        userAgent: "vitest",
        at: at.toISOString(),
        meta: options.meta ?? {},
      }),
      (options.createdAt ?? at).toISOString(),
    ],
  );
}

function trail(projectId: string): Promise<readonly AuditChainRow[]> {
  return reader.chain(projectId);
}

beforeAll(async () => {
  await harness.start();
  reader = new AuditEventReader(harness.db);
  offsets = new RelayOffsetRepository(harness.db);
  relay = new AuditRelay(reader, offsets, clock, new SilentLogger());

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu1', 'EU', 'https://eu.test', 'ring')`,
  );
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES (gen_random_uuid(), 'Acme', (SELECT id FROM region_cells LIMIT 1)) RETURNING id`,
  );
  for (const id of [PROJECT_ONE, PROJECT_TWO]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
       VALUES ($1, $2, 'Acme', (SELECT id FROM region_cells LIMIT 1), 'k')`,
      [id, rows[0]?.id],
    );
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.owner.query(`DELETE FROM outbox`);
  await harness.owner.query(`DELETE FROM audit_events`);
  await harness.owner.query(`DELETE FROM relay_offsets`);
});

describe("building the chain", () => {
  it("writes a verifiable chain from the first entry", async () => {
    await enqueue(PROJECT_ONE, "session.created");
    await enqueue(PROJECT_ONE, "mfa.challenged");

    expect(await relay.sweep()).toBe(2);

    const entries = await trail(PROJECT_ONE);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.prevHash).toBe("0".repeat(64));
    expect(entries[1]?.prevHash).toBe(entries[0]?.entryHash);
    expect(verifyAuditChain(entries)).toEqual({ valid: true });
  });

  /**
   * The reason the sequence column exists. Two entries written in the same millisecond
   * used to leave the project's tip ambiguous, and both would have claimed it.
   *
   * The instant is relative to now and not a literal date. It was
   * `new Date("2026-09-04T00:00:00.000Z")`, which sat inside the relay's cold-start
   * lookback on the day it was written and fell outside it a week later: the sweep then
   * read nothing, and the test failed on the calendar rather than on the code.
   */
  it("keeps one order for entries that share a timestamp", async () => {
    const sameInstant = new Date(Date.now() - 60_000);
    for (const action of ["a", "b", "c", "d"]) {
      await enqueue(PROJECT_ONE, action, { createdAt: sameInstant, at: sameInstant });
    }

    await relay.sweep();

    const entries = await trail(PROJECT_ONE);
    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.seq)).toEqual(
      [...entries.map((e) => e.seq)].sort((a, b) => a - b),
    );
    expect(verifyAuditChain(entries)).toEqual({ valid: true });
  });

  /**
   * The order the chain is built in is the order events were enqueued, even when every
   * one of them shares a timestamp.
   *
   * This is the test that would have caught what the suite was flaking on.
   * `outbox_events_since` ordered by `(created_at, id)` and `id` is a random uuid, so a
   * tie in `created_at` was broken by a random number. Measured against a real database,
   * three events enqueued in a loop shared a millisecond on 29 runs in 30 and reached the
   * chain out of order on 20 of those, which is why the two tampering tests below failed
   * at a different index each run. Eight events make a coincidental pass unlikely enough
   * to be worth asserting on.
   */
  it("chains a burst in enqueue order, not in uuid order", async () => {
    const sameInstant = new Date(Date.now() - 60_000);
    const actions = ["a", "b", "c", "d", "e", "f", "g", "h"];
    for (const action of actions) {
      await enqueue(PROJECT_ONE, action, { createdAt: sameInstant, at: sameInstant });
    }

    expect(await relay.sweep()).toBe(actions.length);

    const entries = await trail(PROJECT_ONE);
    expect(entries.map((entry) => entry.action)).toEqual(actions);
    expect(verifyAuditChain(entries)).toEqual({ valid: true });
  });

  /**
   * Why the watermark has to be the sequence and not `created_at`.
   *
   * An event sharing the last instant of a finished sweep — because it committed after
   * that sweep read, or fell past the reader's LIMIT — was `created_at > since` false for
   * ever under the old cursor. It was never relayed, nothing errored, and the only
   * symptom was an audit entry that did not exist. A hash chain cannot detect that: it
   * verifies what is there.
   */
  it("relays an event that shares the last instant of a finished sweep", async () => {
    const instant = new Date(Date.now() - 60_000);
    await enqueue(PROJECT_ONE, "first", { createdAt: instant, at: instant });
    expect(await relay.sweep()).toBe(1);

    // The same timestamp to the millisecond, enqueued after the watermark was stored.
    await enqueue(PROJECT_ONE, "late", { createdAt: instant, at: instant });
    expect(await relay.sweep()).toBe(1);

    const entries = await trail(PROJECT_ONE);
    expect(entries.map((entry) => entry.action)).toEqual(["first", "late"]);
    expect(verifyAuditChain(entries)).toEqual({ valid: true });
  });

  it("keeps each project on its own chain", async () => {
    await enqueue(PROJECT_ONE, "one.first");
    await enqueue(PROJECT_TWO, "two.first");
    await enqueue(PROJECT_ONE, "one.second");

    await relay.sweep();

    const first = await trail(PROJECT_ONE);
    const second = await trail(PROJECT_TWO);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    // Each project's genesis is its own, so one project's volume cannot be read off
    // another's chain.
    expect(second[0]?.prevHash).toBe("0".repeat(64));
    expect(verifyAuditChain(first)).toEqual({ valid: true });
    expect(verifyAuditChain(second)).toEqual({ valid: true });
  });

  it("picks the chain back up across a restart", async () => {
    await enqueue(PROJECT_ONE, "before", { at: new Date(Date.now() - 60_000) });
    await relay.sweep();

    // A second relay with no memory of the first, which is what a redeploy is.
    const restarted = new AuditRelay(reader, offsets, clock, new SilentLogger());
    await enqueue(PROJECT_ONE, "after");
    expect(await restarted.sweep()).toBe(1);

    const entries = await trail(PROJECT_ONE);
    expect(entries.map((entry) => entry.action)).toEqual(["before", "after"]);
    expect(verifyAuditChain(entries)).toEqual({ valid: true });
  });

  /**
   * A cold start re-reads its lookback window, and that window is the one it has already
   * chained. Every one of those events must land as a no-op.
   *
   * This is the case the relay used to get wrong while looking right. The appended entry
   * is no longer against the tip it was first hashed against — it *is* the tip — so a
   * replay computes a different `prev_hash`, a different `entry_hash`, and collided with
   * nothing. The trail gained each event twice, chained into a sequence that still
   * verified perfectly: no error, a valid chain, and a record claiming more happened than
   * did. `audit_events.outbox_seq` and its unique index are what make the second pass do
   * nothing (0034, 0035).
   */
  it("replays a consumed window without duplicating it", async () => {
    await enqueue(PROJECT_ONE, "first");
    await enqueue(PROJECT_ONE, "second");
    await enqueue(PROJECT_ONE, "third");
    expect(await relay.sweep()).toBe(3);
    const before = await trail(PROJECT_ONE);

    // Losing the offset row is what a cold start is, and the only thing that makes the
    // relay read a window twice.
    await harness.owner.query(`DELETE FROM relay_offsets`);
    expect(await relay.sweep()).toBe(0);

    const after = await trail(PROJECT_ONE);
    expect(after.map((entry) => entry.action)).toEqual(["first", "second", "third"]);
    expect(after.map((entry) => entry.entryHash)).toEqual(before.map((entry) => entry.entryHash));
    expect(verifyAuditChain(after)).toEqual({ valid: true });
  });

  /**
   * The watermark still has to move across a replay. Keyed on entries written rather than
   * events consumed, a sweep that found only duplicates would advance nothing and the
   * relay would re-read the same window on every pass for ever, never reaching what came
   * after it.
   */
  it("moves past a window it only replayed", async () => {
    await enqueue(PROJECT_ONE, "old");
    await relay.sweep();
    await harness.owner.query(`DELETE FROM relay_offsets`);
    expect(await relay.sweep()).toBe(0);

    await enqueue(PROJECT_ONE, "new");
    expect(await relay.sweep()).toBe(1);

    const entries = await trail(PROJECT_ONE);
    expect(entries.map((entry) => entry.action)).toEqual(["old", "new"]);
    expect(verifyAuditChain(entries)).toEqual({ valid: true });
  });

  it("does nothing when there is nothing new", async () => {
    await enqueue(PROJECT_ONE, "only");
    await relay.sweep();

    expect(await relay.sweep()).toBe(0);
    expect(await trail(PROJECT_ONE)).toHaveLength(1);
  });

  it("advances its own watermark and leaves published_at alone", async () => {
    await enqueue(PROJECT_ONE, "watermark");
    await relay.sweep();

    expect(await offsets.read(AUDIT_CONSUMER)).not.toBeNull();
    const { rows } = await harness.owner.query<{ published_at: Date | null }>(
      `SELECT published_at FROM outbox WHERE project_id = $1`,
      [PROJECT_ONE],
    );
    // That column belongs to the Pub/Sub relay. Two consumers sharing one watermark is
    // the bug this consumer's own offset row exists to avoid.
    expect(rows[0]?.published_at).toBeNull();
  });
});

describe("what the chain is for", () => {
  /**
   * The point of the whole mechanism. An entry altered after the fact no longer hashes to
   * what the next one links to, and the verifier names where it broke.
   */
  it("detects an entry altered after the fact", async () => {
    await enqueue(PROJECT_ONE, "first");
    await enqueue(PROJECT_ONE, "second");
    await enqueue(PROJECT_ONE, "third");
    await relay.sweep();

    // Only the owner can do this. The application role has no UPDATE privilege at all,
    // which is asserted separately in packages/testing.
    await harness.owner.query(
      `UPDATE audit_events SET action = 'tampered' WHERE project_id = $1 AND action = 'second'`,
      [PROJECT_ONE],
    );

    const verification = verifyAuditChain(await trail(PROJECT_ONE));
    expect(verification.valid).toBe(false);
    expect(verification.brokenAt).toBe(1);
  });

  it("detects an entry removed from the middle", async () => {
    // Relies on 'second' being the middle of the chain, which holds only because the
    // relay preserves enqueue order. Before 0031 it did not, and this failed at a
    // different index on almost every run.
    await enqueue(PROJECT_ONE, "first");
    await enqueue(PROJECT_ONE, "second");
    await enqueue(PROJECT_ONE, "third");
    await relay.sweep();

    await harness.owner.query(
      `DELETE FROM audit_events WHERE project_id = $1 AND action = 'second'`,
      [PROJECT_ONE],
    );

    const verification = verifyAuditChain(await trail(PROJECT_ONE));
    expect(verification.valid).toBe(false);
    expect(verification.brokenAt).toBe(1);
  });

  /**
   * The two columns an erasure may pseudonymise are outside the digest, so a lawful
   * erasure does not read as tampering (Art.17(3)(b) keeps the entry, not the address).
   */
  it("survives an erasure of the fields an erasure is allowed to touch", async () => {
    await enqueue(PROJECT_ONE, "signed-in");
    await relay.sweep();

    await harness.owner.query(
      `UPDATE audit_events SET ip = NULL, ua = NULL WHERE project_id = $1`,
      [PROJECT_ONE],
    );

    expect(verifyAuditChain(await trail(PROJECT_ONE))).toEqual({ valid: true });
  });
});
