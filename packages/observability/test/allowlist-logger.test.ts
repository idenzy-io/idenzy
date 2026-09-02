import { Writable } from "node:stream";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { AllowlistLogger } from "../src/allowlist-logger.js";

function capture(): { logger: AllowlistLogger; lines: () => Record<string, unknown>[] } {
  const written: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      written.push(String(chunk));
      callback();
    },
  });
  const logger = new AllowlistLogger(
    pino({ level: "info" }, stream),
    new Set(["requestId", "projectId"]),
  );
  return {
    logger,
    lines: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("AllowlistLogger", () => {
  it("keeps allowed fields", () => {
    const { logger, lines } = capture();
    logger.info("signed in", { requestId: "req_1", projectId: "prj_1" });
    expect(lines()[0]).toMatchObject({ requestId: "req_1", projectId: "prj_1" });
  });

  it("drops undeclared fields instead of redacting them", () => {
    const { logger, lines } = capture();
    logger.info("signed in", { requestId: "req_1", email: "alice@example.com" });
    const line = lines()[0] ?? {};
    expect(JSON.stringify(line)).not.toContain("alice@example.com");
    expect(line["email"]).toBeUndefined();
  });

  it("counts dropped fields so the loss is visible", () => {
    const { logger, lines } = capture();
    logger.info("x", { email: "a@b.test", phone: "+1", passwordHash: "$argon2" });
    expect(lines()[0]?.["droppedFields"]).toBe(3);
  });

  it("applies the allowlist to child bindings too", () => {
    const { logger, lines } = capture();
    logger.child({ projectId: "prj_1", email: "alice@example.com" }).info("hello");
    const serialized = JSON.stringify(lines()[0]);
    expect(serialized).toContain("prj_1");
    expect(serialized).not.toContain("alice@example.com");
  });
});
