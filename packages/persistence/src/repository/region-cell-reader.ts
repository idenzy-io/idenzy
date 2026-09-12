import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { regionCells } from "../schema/control-plane.js";

export interface RegionCellRow {
  readonly id: string;
  readonly code: string;
  readonly jurisdiction: string;
  readonly endpoint: string;
}

/**
 * The regions a project can be created in (PROJECT.md 4.13.5).
 *
 * Takes the pool rather than a transaction and a context, because `region_cells` is keyed
 * on nothing: it is the registry of stacks we run, it holds no customer data, and it is
 * the same list for everybody. It carries no RLS policy for the same reason.
 *
 * Only active cells are offered. A cell being in the table is not a promise that it is
 * taking new projects — draining one before a migration means marking it inactive, and an
 * onboarding form that kept offering it would pin somebody's data to a stack we are
 * emptying.
 */
export class RegionCellReader {
  constructor(private readonly db: NodePgDatabase) {}

  async active(): Promise<RegionCellRow[]> {
    const rows = await this.db
      .select()
      .from(regionCells)
      .where(eq(regionCells.active, true))
      .orderBy(asc(regionCells.code));
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      jurisdiction: row.jurisdiction,
      endpoint: row.endpoint,
    }));
  }

  /** One active cell by its code, or null. What an onboarding submission is checked against. */
  async byCode(code: string): Promise<RegionCellRow | null> {
    const cells = await this.active();
    return cells.find((cell) => cell.code === code) ?? null;
  }
}
