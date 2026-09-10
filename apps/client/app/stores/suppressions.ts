/**
 * Each project's suppression list, as the panel sees it.
 *
 * Rows of `suppressions`, unique on project, channel and target hash, read and written
 * through the management API; this store is those rows with a placeholder until the
 * client exists. Nothing on the server writes one yet, so a real project's list is empty
 * and stays empty until the provider event pipeline lands; the placeholder fills Acme's
 * so the screen can be seen working, and leaves Personal Team's empty so the state a real
 * project is in can be seen too.
 *
 * The placeholder is seeded from addresses the users store already holds, hashed the same
 * way the server hashes them. That is what makes the lookup real: an operator can take an
 * address off the users list, ask about it here, and get an answer that agrees. Inventing
 * addresses instead would make the one control on the screen impossible to try.
 */

import { hashAddress, type SuppressionRow } from "~/utils/suppressions";

/** Which of a project's accounts the placeholder marks, and why. */
const SEED_REASONS = ["hard_bounce", "complaint", "hard_bounce", "invalid_address", "manual"];

const PLACEHOLDER_LATENCY = 700;
const WRITE_LATENCY = 600;

export const useSuppressionsStore = defineStore("suppressions", () => {
  const users = useUsersStore();

  const rows = ref<Record<string, SuppressionRow[]>>({});
  const loading = ref(true);
  const lastChanged = ref<Record<string, string>>({});

  let seeded = false;
  watch(
    () => users.users,
    (list) => {
      if (seeded || list.length === 0) return;
      seeded = true;
      void seed();
    },
    { immediate: true },
  );

  /** Async because the digest is, and the digest is the whole point of the row. */
  async function seed() {
    await new Promise((resolve) => setTimeout(resolve, PLACEHOLDER_LATENCY));
    const acme = users
      .forProject("prj_acme")
      .filter((user) => user.email !== null && user.deletedAt === null)
      .slice(0, SEED_REASONS.length);

    const built: SuppressionRow[] = [];
    for (const [index, user] of acme.entries()) {
      const email = user.email;
      const reason = SEED_REASONS[index];
      if (email === null || reason === undefined) continue;
      built.push({
        id: `sup_${index + 1}`,
        channel: "email",
        targetHash: await hashAddress(email),
        reason,
        createdAt: new Date(Date.now() - (index + 1) * 36 * 3600 * 1000).toISOString(),
      });
    }

    rows.value = { prj_personal: [], prj_acme: built };
    loading.value = false;
  }

  function forProject(projectId: string): SuppressionRow[] {
    return rows.value[projectId] ?? [];
  }

  /**
   * Whether one digest is on the list, which is the only question the table can answer.
   *
   * Takes a digest rather than an address on purpose: the address is hashed in the
   * browser and never travels, which is the same reason the column is a digest at all.
   */
  function find(projectId: string, targetHash: string): SuppressionRow | null {
    return forProject(projectId).find((row) => row.targetHash === targetHash) ?? null;
  }

  /**
   * Takes an address off the list, by digest.
   *
   * A delete and not a flag: PROJECT.md 11.1 makes this a deliberate customer action, and
   * a released address is sendable again on the next attempt with nothing left behind
   * saying it once was not.
   */
  async function release(projectId: string, targetHash: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, WRITE_LATENCY));
    rows.value = {
      ...rows.value,
      [projectId]: forProject(projectId).filter((row) => row.targetHash !== targetHash),
    };
    lastChanged.value = { ...lastChanged.value, [projectId]: new Date().toISOString() };
  }

  function lastChangedAt(projectId: string): string | null {
    return lastChanged.value[projectId] ?? null;
  }

  return { rows, loading, forProject, find, release, lastChangedAt };
});
