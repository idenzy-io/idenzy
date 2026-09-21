import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Erasure } from "@idenzy/compliance/classification/vocabulary";
import { generateSubjectFields } from "@idenzy/compliance/generators/subject-fields";
import { Logger } from "@idenzy/core/logging/logger";
import "@idenzy/persistence/schema/index";
import type { RetentionPruner } from "@idenzy/persistence/repository/retention-pruner";
import { RETENTION_DEFAULTS, RetentionSubject } from "@idenzy/protocol/enums/compliance";
import { describe, expect, it } from "vitest";
import { RetentionSweeper } from "../src/retention-sweeper.js";

class SilentLogger extends Logger {
  readonly errors: string[] = [];
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(message: string): void {
    this.errors.push(message);
  }
  override child(): Logger {
    return this;
  }
}

function pruner(answer: () => Promise<Record<string, number>>): RetentionPruner {
  return { prune: answer } as unknown as RetentionPruner;
}

describe("the ages a project with no policy is swept at", () => {
  it("are the protocol's, so the menu's default and the delete agree", () => {
    const sweeper = new RetentionSweeper(
      pruner(async () => ({})),
      new SilentLogger(),
    );
    expect(sweeper.defaults()).toEqual({
      sessions: RETENTION_DEFAULTS[RetentionSubject.Sessions],
      otpChallenges: RETENTION_DEFAULTS[RetentionSubject.OtpChallenges],
      oauthFlows: RETENTION_DEFAULTS[RetentionSubject.OauthFlows],
      users: RETENTION_DEFAULTS[RetentionSubject.Users],
    });
  });
});

describe("a pass that fails", () => {
  it("is logged and not thrown: the rows are still there and the next pass is an hour away", async () => {
    const logger = new SilentLogger();
    const sweeper = new RetentionSweeper(
      pruner(() => Promise.reject(new Error("connection lost"))),
      logger,
    );
    await expect(sweeper.sweep()).resolves.toBe(0);
    expect(logger.errors).toEqual(["retention sweep failed"]);
  });
});

/**
 * The tombstone's column list, against the one `classified()` generates.
 *
 * `retention_tombstone_users` names its columns in SQL because a SECURITY DEFINER function
 * taking a column list from its caller is not a thing worth building. That makes the list a
 * second copy of a classification the schema already owns, and this is what stops the copy
 * drifting: a column added to `users` with an erasure action next year fails here rather than
 * being quietly left behind in every tombstoned row, which is a GDPR Art.17 failure nobody
 * would notice until somebody read a row.
 */
describe("what a tombstone clears", () => {
  it("is exactly what classified() marks for erasure on users", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const drizzle = join(here, "..", "..", "..", "packages", "persistence", "drizzle");

    // Found rather than named. This test read `0052_retention_sweep.sql` by hand until the
    // squash to one baseline deleted it, and a test that fails because a migration was
    // renumbered says nothing about the classification it exists to check. The last file
    // that defines the function is the one that wins at runtime, so it is the one to read.
    const files = (await readdir(drizzle)).filter((name) => name.endsWith(".sql")).sort();
    const marker = /CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?retention_tombstone_users/;
    let body = "";
    for (const file of files) {
      const sql = await readFile(join(drizzle, file), "utf8");
      const at = sql.search(marker);
      if (at !== -1) body = sql.slice(at);
    }
    expect(body, "retention_tombstone_users is defined by no migration").not.toBe("");
    const assignments = body.slice(body.indexOf("UPDATE users u SET"), body.indexOf("FROM doomed"));
    const cleared = new Set(
      [...assignments.matchAll(/^\s{4}(\w+) =/gm)].map((match) => match[1] ?? ""),
    );
    // Written by the statement rather than cleared by it, and not a classified erasure column.
    cleared.delete("updated_at");

    const declared = generateSubjectFields().erase.get("users") ?? new Map<string, Erasure>();
    const expected = new Set(
      [...declared.keys()].map((column) => column.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)),
    );

    expect([...cleared].sort()).toEqual([...expected].sort());
  });
});
