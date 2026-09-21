import { InternalError } from "@idenzy/core/errors";
import {
  type JurisdictionPolicy,
  jurisdictionFrom,
  jurisdictionPolicyFor,
} from "@idenzy/domain/policies/jurisdiction-policy";
import type { RegionCellReader } from "@idenzy/persistence/repository/region-cell-reader";

/**
 * Which region cell this process serves, in both the forms the request path needs
 * (PROJECT.md 4.13.5).
 *
 * `CELL_CODE` is a string like `us1` and `projects.cell_id` is a uuid, so a cross-cell check has
 * to hold both. The two halves are deliberately asymmetric:
 *
 * - The **code** comes from configuration and is available immediately. That is what the first
 *   line of the refusal compares a key's segment against, which is why that line can run before
 *   any lookup and therefore before anything has been learned about whether the key is real.
 * - The **id** requires the registry, so it is resolved once on first use and cached. Only the
 *   Host path needs it, where no key is presented and the project has to be looked up anyway.
 *
 * Resolving the id lazily rather than in the provider factory is not a shortcut. `wiring.test.ts`
 * compiles the whole composition root and asserts it resolves without touching the database, so
 * that a DI mistake is caught by a unit test rather than by a container that will not start. A
 * factory that queried at construction would have made that test require Postgres, trading a
 * property worth keeping for boot-time validation that `warm()` provides anyway.
 *
 * `all()` rather than `active()`, deliberately: a cell being drained still serves the projects
 * already in it — that is what draining means — so a process refusing to start because its own
 * cell had been marked inactive would take the cell down in order to empty it.
 */
export class LocalCell {
  private id: string | null = null;
  private law: JurisdictionPolicy | null = null;

  constructor(
    readonly code: string,
    private readonly regions: RegionCellReader,
  ) {}

  /**
   * Resolves and caches this cell's id.
   *
   * Throws where `CELL_CODE` names no row, which is a misconfiguration and not a request fault:
   * a process that cannot say which cell it is cannot decide the jurisdiction of anything it
   * serves.
   */
  private async cellId(): Promise<string> {
    if (this.id !== null) return this.id;

    const cells = await this.regions.all();
    const match = cells.find((candidate) => candidate.code === this.code);
    if (match === undefined) {
      throw new InternalError({
        detail: {
          cellCode: this.code,
          reason: "CELL_CODE names no row in region_cells",
          rule: "a process must know which cell it serves (PROJECT.md 4.13.5)",
        },
      });
    }
    const jurisdiction = jurisdictionFrom(match.jurisdiction);
    if (jurisdiction === null) {
      throw new InternalError({
        detail: {
          cellCode: this.code,
          jurisdiction: match.jurisdiction,
          reason: "region_cells.jurisdiction is not one this build knows",
          rule: "a cell must sit under a law the code can act on (PROJECT.md 4.13.5)",
        },
      });
    }

    this.id = match.id;
    this.law = jurisdictionPolicyFor(jurisdiction);
    return match.id;
  }

  /**
   * What this cell's jurisdiction requires — a data-subject deadline, a region mail may leave
   * from. Resolved with the id, because both come from the same registry row.
   */
  async policy(): Promise<JurisdictionPolicy> {
    await this.cellId();
    // Set by `cellId` on the line above, which throws rather than leaving it null.
    return this.law as JurisdictionPolicy;
  }

  /**
   * Resolves the id ahead of the first request, for `main.ts` to await at boot.
   *
   * The same work the first Host-resolved request would do, done where a failure is a startup
   * error somebody reads rather than one refused request in a log.
   */
  async warm(): Promise<void> {
    await this.cellId();
  }

  /** Whether a key's cell segment names this cell. Compared before any lookup, and free. */
  servesCode(code: string): boolean {
    return code === this.code;
  }

  /** Whether a resolved project lives here. For the Host path, which presents no key. */
  async servesId(cellId: string): Promise<boolean> {
    return cellId === (await this.cellId());
  }
}
