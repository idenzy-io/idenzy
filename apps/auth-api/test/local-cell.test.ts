import type {
  RegionCellReader,
  RegionCellRow,
} from "@idenzy/persistence/repository/region-cell-reader";
import { Jurisdiction } from "@idenzy/protocol/enums/tenancy";
import { describe, expect, it } from "vitest";
import { LocalCell } from "../dist/tenancy/local-cell.js";

/** A registry with exactly the rows a case needs, and a count of how often it was read. */
function registry(rows: RegionCellRow[]): { reader: RegionCellReader; reads: () => number } {
  let reads = 0;
  const reader = {
    all: () => {
      reads += 1;
      return Promise.resolve(rows);
    },
  } as unknown as RegionCellReader;
  return { reader, reads: () => reads };
}

const US1: RegionCellRow = {
  id: "11111111-1111-1111-1111-111111111111",
  code: "us1",
  jurisdiction: Jurisdiction.Us,
  endpoint: "https://us.idenzy.io",
};
const EU1: RegionCellRow = {
  id: "22222222-2222-2222-2222-222222222222",
  code: "eu1",
  jurisdiction: Jurisdiction.Eu,
  endpoint: "https://eu.idenzy.io",
};

describe("the cell this process serves", () => {
  /**
   * The first line of the cross-cell refusal has to work before anything has been read, because
   * its whole value is refusing a key without touching the database. A code comparison that
   * needed the registry would have quietly become a lookup.
   */
  it("compares a key's cell without reading the registry at all", () => {
    const { reader, reads } = registry([US1]);
    const cell = new LocalCell("us1", reader);

    expect(cell.servesCode("us1")).toBe(true);
    expect(cell.servesCode("eu1")).toBe(false);
    expect(reads()).toBe(0);
  });

  it("resolves its uuid once and caches it", async () => {
    const { reader, reads } = registry([US1, EU1]);
    const cell = new LocalCell("us1", reader);

    expect(await cell.servesId(US1.id)).toBe(true);
    expect(await cell.servesId(EU1.id)).toBe(false);
    // Twice asked, once read. Every Host-resolved request goes through this.
    expect(reads()).toBe(1);
  });

  it("refuses to start when CELL_CODE names no cell", async () => {
    const { reader } = registry([EU1]);
    const cell = new LocalCell("us1", reader);
    // The detail rather than only the code: it is what an operator reads at three in the
    // morning, and a startup failure whose message is generic is a startup failure twice.
    await expect(cell.warm()).rejects.toMatchObject({
      code: "internal_error",
      detail: { reason: "CELL_CODE names no row in region_cells" },
    });
  });

  /**
   * A cell provisioned against a law nobody encoded. Serving it would mean answering
   * data-subject requests on a deadline picked by a fallback and sending its mail wherever the
   * environment happened to say — both invisible until an audit.
   */
  it("refuses to start when the jurisdiction is not one this build knows", async () => {
    const { reader } = registry([{ ...US1, jurisdiction: "Atlantis" }]);
    const cell = new LocalCell("us1", reader);
    await expect(cell.warm()).rejects.toMatchObject({
      code: "internal_error",
      detail: { jurisdiction: "Atlantis" },
    });
  });

  it("carries the law of the cell it serves", async () => {
    const eu = new LocalCell("eu1", registry([US1, EU1]).reader);
    const law = await eu.policy();

    expect(law.jurisdiction).toBe(Jurisdiction.Eu);
    expect(law.permitsEmailRegion("eu-west-1")).toBe(true);
    // The check `main.ts` makes at boot, and the reason it is worth making: this configuration
    // sends every OTP for an EU cell through the United States and nothing else would notice.
    expect(law.permitsEmailRegion("us-east-1")).toBe(false);
  });
});
