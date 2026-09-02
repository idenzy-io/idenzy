import { createHash } from "node:crypto";

export interface AuditEntryDigestInput {
  readonly projectId: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly createdAt: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Genesis value for a project's first audit entry. */
export const AUDIT_CHAIN_GENESIS = "0".repeat(64);

/**
 * Canonical form of an audit entry. Key order is fixed and explicit, because a hash
 * chain that depends on JSON key ordering verifies today and fails after a refactor.
 */
function canonicalize(entry: AuditEntryDigestInput): string {
  return JSON.stringify([
    entry.projectId,
    entry.actorType,
    entry.actorId,
    entry.action,
    entry.target,
    entry.createdAt.toISOString(),
    sortedJson(entry.metadata),
  ]);
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortedJson(v)]),
    );
  }
  return value;
}

/** `entry_hash = H(prev_hash || canonical(entry))` (PROJECT.md 4.13.3). */
export function auditEntryHash(previousHash: string, entry: AuditEntryDigestInput): string {
  return createHash("sha256").update(previousHash).update(canonicalize(entry)).digest("hex");
}

export interface ChainLink extends AuditEntryDigestInput {
  readonly prevHash: string;
  readonly entryHash: string;
}

export interface ChainVerification {
  readonly valid: boolean;
  /** Index of the first entry that does not verify, if any. */
  readonly brokenAt?: number;
}

/**
 * Verifies a project's audit chain. Run on a schedule, because the value of a hash
 * chain is entirely in someone checking it.
 */
export function verifyAuditChain(entries: readonly ChainLink[]): ChainVerification {
  let previous = AUDIT_CHAIN_GENESIS;
  for (const [index, entry] of entries.entries()) {
    if (entry.prevHash !== previous) return { valid: false, brokenAt: index };
    if (auditEntryHash(previous, entry) !== entry.entryHash)
      return { valid: false, brokenAt: index };
    previous = entry.entryHash;
  }
  return { valid: true };
}
