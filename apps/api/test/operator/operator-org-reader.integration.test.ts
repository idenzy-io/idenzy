import { OperatorOrgReader } from "@idenzy/persistence/repository/operator-org-reader";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** How the operator console finds an organisation (ADR-0018). */
const harness = new PostgresHarness();
const ACME = "11110000-0000-4000-8000-000000000001";
let reader: OperatorOrgReader;

beforeAll(async () => {
  await harness.start();
  reader = new OperatorOrgReader(harness.db);
  await harness.owner.query(
    `INSERT INTO orgs (id, name) VALUES ($1, 'Acme Corp'), (gen_random_uuid(), 'Globex'),
       (gen_random_uuid(), '100% Real Co')`,
    [ACME],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("searching organisations", () => {
  it("finds by part of a name, whatever the case", async () => {
    expect((await reader.search("acme", 10)).map((org) => org.name)).toEqual(["Acme Corp"]);
  });

  it("finds by exact id", async () => {
    expect((await reader.search(ACME, 10)).map((org) => org.id)).toEqual([ACME]);
  });

  /** An operator typing a percent sign is looking for one, not for every organisation. */
  it("matches LIKE's wildcards literally", async () => {
    expect((await reader.search("%", 10)).map((org) => org.name)).toEqual(["100% Real Co"]);
    expect(await reader.search("_", 10)).toEqual([]);
  });

  it("lists the newest when the query is empty", async () => {
    expect(await reader.search("", 10)).toHaveLength(3);
  });
});
