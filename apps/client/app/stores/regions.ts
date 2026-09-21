/**
 * The region cells we actually run, read once from the server.
 *
 * `GET /v1/regions` is the only source. The panel used to carry its own copy of this list —
 * codes, endpoints and key ring names written into the bundle — which drifts the moment a cell
 * is provisioned or renamed, and drifts silently: a stale endpoint renders as a plausible URL
 * rather than as an error. A customer choosing where their users' data lives is the last screen
 * that should be reading a hardcoded guess.
 *
 * The label is the one thing that stays here. The server sends a code and the law that applies;
 * "us1" is an identifier, not something to put in front of somebody making that choice. A cell
 * we have not named falls back to its own code, so a new region is usable the day it exists
 * rather than the day somebody writes a place name for it.
 */
import type { RegionList } from "@idenzy/protocol/schemas/management";
import { managementMessage } from "~/utils/sign-in-errors";

export interface RegionCell {
  /** `region_cells.code`, which is what a project's `cellCode` is compared against. */
  code: string;
  label: string;
  /** The law the data sits under, written for a reader. `region_cells.jurisdiction` is a code. */
  jurisdiction: string;
  /** The API host for projects in this cell. What a customer's SDK is pointed at. */
  endpoint: string;
}

const REGION_LABELS: Record<string, string> = {
  us1: "United States (Iowa)",
  eu1: "Europe (Netherlands)",
};

/**
 * The law, written out.
 *
 * The server sends a code because code branches on it — a data-subject deadline and the region
 * email may leave from both follow the jurisdiction, so it has to be a value and not a sentence.
 * "EU" is the right thing to store and the wrong thing to show somebody deciding where their
 * users' data will live. Unknown falls back to the code, like the region label above.
 */
const JURISDICTION_LABELS: Record<string, string> = {
  EU: "European Union",
  US: "United States",
};

export const useRegionsStore = defineStore("regions", () => {
  const cells = ref<RegionCell[]>([]);
  const loading = ref(false);
  /** The refusal the server gave, in the reader's words. Null while nothing was refused. */
  const refusal = ref<string | null>(null);

  /** Idempotent: the registry changes by provisioning, not within a session. */
  async function load(): Promise<void> {
    if (cells.value.length > 0 || loading.value) return;
    loading.value = true;
    try {
      const api = useManagementApi();
      const { data, error } = await api("/v1/regions").get().json<RegionList>();
      if (error.value !== null) throw error.value;
      cells.value = (data.value?.regions ?? []).map((region) => ({
        code: region.code,
        label: REGION_LABELS[region.code] ?? region.code,
        jurisdiction: JURISDICTION_LABELS[region.jurisdiction] ?? region.jurisdiction,
        endpoint: region.endpoint,
      }));
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  /**
   * The cell a project is pinned to, or null before the registry has loaded.
   *
   * Null is a real answer and not only a loading state: a project can name a cell this build
   * has never heard of, and rendering nothing is honest where inventing a place name is not.
   */
  function byCode(code: string): RegionCell | null {
    return cells.value.find((cell) => cell.code === code) ?? null;
  }

  return { cells, loading, refusal, load, byCode };
});
