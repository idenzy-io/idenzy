/**
 * Each project's CORS allowlist (`project_origins`, ADR-0006), and the origins the API
 * has answered without an allow header.
 *
 * The second half is what makes this screen an operational one rather than a form. The
 * server sees the `Origin` on a request whether or not it is registered, so a page
 * calling from an origin nobody allowed is visible to us and invisible to the customer:
 * their browser reports a CORS error and the request looks fine in our logs. Surfacing
 * what we saw is the honest fix for the first-run failure the ADR names.
 *
 * A placeholder until the management client exists, like every store here.
 */

import {
  type AllowedOrigin,
  ORIGIN_TELEMETRY,
  type OriginSource,
  sortOrigins,
} from "~/utils/origins";
import { normaliseOrigin } from "~/utils/passkeys";

/** An origin the API answered for and did not allow. Not an attack, usually a typo. */
export interface UnknownOrigin {
  origin: string;
  /** Requests carrying it over the last thirty days. */
  calls: number;
  lastSeen: string;
}

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export const useOriginsStore = defineStore("origins", () => {
  const origins = ref<Record<string, AllowedOrigin[]>>({});
  const unknown = ref<Record<string, UnknownOrigin[]>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    origins.value = {
      prj_personal: [],
      prj_acme: [
        { origin: "https://app.acme.com", addedAt: "2026-06-04T10:12:00.000Z", source: null },
        {
          origin: "https://www.acme.com",
          addedAt: "2026-06-04T10:14:00.000Z",
          source: "magic_link",
        },
      ],
    };
    unknown.value = {
      prj_personal: [],
      prj_acme: [
        { origin: "https://staging.acme.com", calls: 412, lastSeen: "2026-09-09T05:41:00.000Z" },
        {
          origin: "https://acme-preview.vercel.app",
          calls: 37,
          lastSeen: "2026-09-08T18:02:00.000Z",
        },
      ],
    };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): AllowedOrigin[] {
    return sortOrigins(origins.value[projectId] ?? []);
  }

  /**
   * The origins the API answered for and did not allow.
   *
   * Empty while nothing records them, which is every deployment today. The fixtures stay
   * behind the check so they come back with the pipeline; drawing them now would be the
   * screen telling an operator it had watched for blocked calls when nothing is watching,
   * and on this list a false "nothing was refused" is the most expensive answer there is
   * (notes/domains-origins.md, acceptance checks).
   */
  function unknownFor(projectId: string): UnknownOrigin[] {
    if (!ORIGIN_TELEMETRY) return [];
    const held = unknown.value[projectId] ?? [];
    const allowed = forProject(projectId).map((entry) => entry.origin);
    /* One that has since been allowed drops off rather than lingering as a warning about
       something already done. The counts stay as they were: they are history. */
    return held
      .filter((entry) => !allowed.includes(normaliseOrigin(entry.origin)))
      .sort((first, next) => next.calls - first.calls);
  }

  function write(projectId: string, next: AllowedOrigin[]) {
    origins.value = { ...origins.value, [projectId]: next };
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  /** Adding one that is already there is a no-op rather than a second row. */
  async function add(
    projectId: string,
    origin: string,
    source: OriginSource | null = null,
  ): Promise<void> {
    const value = normaliseOrigin(origin);
    const held = forProject(projectId);
    if (held.some((entry) => entry.origin === value)) return;
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(projectId, [...held, { origin: value, addedAt: new Date().toISOString(), source }]);
  }

  async function remove(projectId: string, origin: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(
      projectId,
      forProject(projectId).filter((entry) => entry.origin !== normaliseOrigin(origin)),
    );
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return { origins, unknown, loading, forProject, unknownFor, add, remove, lastSavedAt };
});
