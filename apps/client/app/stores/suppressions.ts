/**
 * Each project's blocked addresses, as the panel sees them.
 *
 * Rows of `suppressions`, unique on project, channel and target hash, read and written
 * through the management API; this store is those rows with a placeholder until the client
 * exists. Nothing on the server writes one yet, so a real project's list is empty and
 * stays empty until the provider event pipeline lands; the placeholder fills Acme's so the
 * screen can be seen working, and leaves Personal Team's empty so the state a real project
 * is in can be seen too.
 *
 * The placeholder is seeded from addresses the users store already holds, hashed the same
 * way the server hashes them. That is what makes the lookup real: an operator can take an
 * address off the users list, ask about it here, and get an answer that agrees. Inventing
 * addresses instead would make the one control on the screen impossible to try.
 *
 * A release deletes the row and keeps a `ReleaseRecord`, because the decision outlives the
 * block: the trail says an address was let back through and on what evidence, which is
 * what the audit trail will hold when it reaches this table.
 */

import { hashAddress, type ReleaseRecord, type SuppressionRow } from "~/utils/suppressions";

/** Which of a project's accounts the placeholder marks, and why. */
const SEED_REASONS = ["hard_bounce", "complaint", "hard_bounce", "invalid_address", "manual"];

/**
 * The seeded account that is blocked on SMS as well as email.
 *
 * One address blocked twice is the only way the per-channel rule can be seen: releasing
 * the email block has to leave the SMS one standing, and a placeholder where no address
 * carries both would make that claim untestable.
 */
const SMS_TOO = 1;

const PLACEHOLDER_LATENCY = 700;
const WRITE_LATENCY = 600;

export const useSuppressionsStore = defineStore("suppressions", () => {
  const users = useUsersStore();

  const rows = ref<Record<string, SuppressionRow[]>>({});
  const releases = ref<Record<string, ReleaseRecord[]>>({});
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
      const targetHash = await hashAddress(email);
      const createdAt = new Date(Date.now() - (index + 1) * 36 * 3600 * 1000).toISOString();
      built.push({
        id: `sup_${index + 1}`,
        channel: "email",
        targetHash,
        reason,
        createdAt,
        ...(reason === "manual" ? {} : { providerEventId: `evt_${targetHash.slice(0, 12)}` }),
      });
      if (index === SMS_TOO) {
        built.push({
          id: `sup_${index + 1}_sms`,
          channel: "sms",
          targetHash,
          reason: "manual",
          createdAt,
        });
      }
    }

    rows.value = { prj_personal: [], prj_acme: built };
    loading.value = false;
  }

  function forProject(projectId: string): SuppressionRow[] {
    return rows.value[projectId] ?? [];
  }

  /**
   * Every channel this digest is blocked on in one project.
   *
   * Takes a digest rather than an address on purpose: the address is hashed in the browser
   * and never travels, which is the same reason the column is a digest at all.
   */
  function matches(projectId: string, targetHash: string): SuppressionRow[] {
    return forProject(projectId).filter((row) => row.targetHash === targetHash);
  }

  /** One channel's block, which is the only question this screen's verdict answers. */
  function find(
    projectId: string,
    targetHash: string,
    channel: SuppressionRow["channel"] = "email",
  ): SuppressionRow | null {
    return matches(projectId, targetHash).find((row) => row.channel === channel) ?? null;
  }

  /**
   * Takes one address off the list, on one channel.
   *
   * A delete and not a flag: PROJECT.md 11.1 makes this a deliberate customer action, and
   * a released address is sendable again on the next attempt. The decision survives as a
   * `ReleaseRecord`, so releasing does not erase the fact that it happened, and the
   * channel is part of the key so an email release leaves SMS blocked.
   */
  async function release(
    projectId: string,
    targetHash: string,
    channel: SuppressionRow["channel"],
    justification: string,
  ): Promise<ReleaseRecord> {
    await new Promise((resolve) => setTimeout(resolve, WRITE_LATENCY));

    const row = find(projectId, targetHash, channel);
    const releasedAt = new Date().toISOString();
    const record: ReleaseRecord = {
      id: `rel_${targetHash.slice(0, 10)}_${channel}`,
      channel,
      targetHash,
      reason: row?.reason ?? "unknown",
      releasedAt,
      justification: justification.trim(),
    };

    rows.value = {
      ...rows.value,
      [projectId]: forProject(projectId).filter(
        (entry) => !(entry.targetHash === targetHash && entry.channel === channel),
      ),
    };
    releases.value = {
      ...releases.value,
      [projectId]: [record, ...releasesFor(projectId)],
    };
    lastChanged.value = { ...lastChanged.value, [projectId]: releasedAt };
    return record;
  }

  function releasesFor(projectId: string): ReleaseRecord[] {
    return releases.value[projectId] ?? [];
  }

  function lastChangedAt(projectId: string): string | null {
    return lastChanged.value[projectId] ?? null;
  }

  return {
    rows,
    releases,
    loading,
    forProject,
    matches,
    find,
    release,
    releasesFor,
    lastChangedAt,
  };
});
