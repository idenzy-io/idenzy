import { LiveBalanceCache } from "@idenzy/cache/live-balance-cache";
import { ResourceNotFoundError } from "@idenzy/core/errors";
import { SystemClock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { OperatorOrgReader } from "@idenzy/persistence/repository/operator-org-reader";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { InMemoryKeyValue, RecordingBillingSignals } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// From `dist`, like every other app test.
import { OrgBalanceReader } from "../../dist/management/billing/org-balance-reader.js";
import { OperatorBillingService } from "../../dist/operator/operator-billing-service.js";
import { SilentLogger } from "../management/fixtures.js";

/**
 * Switching how an organisation pays, from the operator console (ADR-0019).
 *
 * The property worth a database for: the change and the record of who made it, and why, commit
 * together or not at all.
 */
const harness = new PostgresHarness();
const ORG = "77770000-0000-4000-8000-000000000001";
const ORG_PUBLIC = PublicId.encode(IdPrefix.Org, ORG).value;
let service: OperatorBillingService;
let signals: RecordingBillingSignals;
let staffId: string;

beforeAll(async () => {
  await harness.start();
  const uow = new UnitOfWork(harness.db);
  signals = new RecordingBillingSignals();
  service = new OperatorBillingService(
    uow,
    new OperatorOrgReader(harness.db),
    new OrgBalanceReader(
      uow,
      new LiveBalanceCache(new InMemoryKeyValue()),
      new SystemClock(),
      new SilentLogger(),
    ),
    signals,
  );
  await harness.owner.query(`INSERT INTO orgs (id, name) VALUES ($1, 'Globex')`, [ORG]);
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO staff (email, role) VALUES ('ada@idenzy.io', 'billing') RETURNING id`,
  );
  staffId = rows[0]?.id ?? "";
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

const operator = () => ({ staffId, email: "ada@idenzy.io", role: "billing" as const });

describe("switching how an organisation pays", () => {
  it("starts every organisation prepaid, on fourteen days' terms", async () => {
    const billing = await service.load(ORG_PUBLIC, "req");
    expect(billing).toMatchObject({ mode: "prepaid", invoiceTermsDays: 14 });
    expect(billing.org.name).toBe("Globex");
  });

  it("switches to invoicing, and records who did it and why", async () => {
    await service.setMode(
      ORG_PUBLIC,
      {
        mode: "invoiced",
        invoiceTermsDays: 30,
        invoiceEmail: "AP@Globex.test",
        reason: "Signed enterprise agreement #88",
      },
      operator(),
      "req",
    );
    expect(await service.load(ORG_PUBLIC, "req")).toMatchObject({
      mode: "invoiced",
      invoiceTermsDays: 30,
    });

    const { rows } = await harness.owner.query<{
      staff_id: string;
      action: string;
      org_id: string;
      reason: string;
      detail: Record<string, unknown>;
    }>(`SELECT staff_id, action, org_id, reason, detail FROM operator_actions`);
    expect(rows).toEqual([
      {
        staff_id: staffId,
        action: "billing.set_mode",
        org_id: ORG,
        reason: "Signed enterprise agreement #88",
        detail: {
          from: { mode: "prepaid", invoiceTermsDays: 14, invoiceEmail: null },
          to: { mode: "invoiced", invoiceTermsDays: 30, invoiceEmail: "ap@globex.test" },
        },
      },
    ]);
    expect(signals.sent).toContainEqual({ signal: "rule_changed", id: ORG });
    expect(signals.sent).toContainEqual({ signal: "wallet_moved", id: ORG });
  });

  /** An audit row that cannot be written takes the change with it. */
  it("changes nothing when the record of the change cannot be written", async () => {
    await expect(
      service.setMode(
        ORG_PUBLIC,
        { mode: "prepaid", invoiceTermsDays: 14, invoiceEmail: null, reason: "Back to prepaid" },
        { ...operator(), staffId: "00000000-0000-4000-8000-00000000dead" },
        "req",
      ),
    ).rejects.toThrow();
    expect((await service.load(ORG_PUBLIC, "req")).mode).toBe("invoiced");
  });

  it("refuses an organisation that does not exist", async () => {
    const missing = PublicId.encode(IdPrefix.Org, "88880000-0000-4000-8000-000000000001").value;
    await expect(service.load(missing, "req")).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      service.setMode(
        missing,
        {
          mode: "invoiced",
          invoiceTermsDays: 14,
          invoiceEmail: "ap@missing.test",
          reason: "x".repeat(5),
        },
        operator(),
        "req",
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
