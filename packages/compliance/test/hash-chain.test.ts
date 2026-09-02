import { describe, expect, it } from "vitest";
import {
  AUDIT_CHAIN_GENESIS,
  auditEntryHash,
  type ChainLink,
  verifyAuditChain,
} from "../src/audit/hash-chain.js";

function link(previous: string, action: string, metadata: Record<string, unknown> = {}): ChainLink {
  const entry = {
    projectId: "prj_1",
    actorType: "user",
    actorId: "usr_1",
    action,
    target: null,
    createdAt: new Date("2026-09-03T00:00:00.000Z"),
    metadata,
  };
  return { ...entry, prevHash: previous, entryHash: auditEntryHash(previous, entry) };
}

describe("audit hash chain", () => {
  it("verifies an untouched chain", () => {
    const a = link(AUDIT_CHAIN_GENESIS, "user.created");
    const b = link(a.entryHash, "session.created");
    expect(verifyAuditChain([a, b])).toEqual({ valid: true });
  });

  it("detects an edited entry", () => {
    const a = link(AUDIT_CHAIN_GENESIS, "user.created");
    const b = link(a.entryHash, "session.created");
    const tampered = { ...b, action: "session.deleted" };
    expect(verifyAuditChain([a, tampered])).toEqual({ valid: false, brokenAt: 1 });
  });

  it("detects a removed entry", () => {
    const a = link(AUDIT_CHAIN_GENESIS, "user.created");
    const b = link(a.entryHash, "session.created");
    const c = link(b.entryHash, "user.deleted");
    expect(verifyAuditChain([a, c])).toEqual({ valid: false, brokenAt: 1 });
  });

  it("is stable across metadata key order", () => {
    const base = {
      projectId: "prj_1",
      actorType: "user",
      actorId: null,
      action: "a",
      target: null,
      createdAt: new Date(0),
    };
    const first = auditEntryHash(AUDIT_CHAIN_GENESIS, { ...base, metadata: { b: 2, a: 1 } });
    const second = auditEntryHash(AUDIT_CHAIN_GENESIS, { ...base, metadata: { a: 1, b: 2 } });
    expect(first).toBe(second);
  });
});
