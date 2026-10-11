import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { subjectRegistry } from "@idenzy/compliance/classification/registry";
import { SubjectPopulation } from "@idenzy/compliance/classification/vocabulary";
import { generateSubjectFields } from "@idenzy/compliance/generators/subject-fields";
import "@idenzy/persistence/schema/index";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * `erase_user` against the classification it is a copy of.
 *
 * The function names its tables and columns in SQL, for the reason `retention_tombstone_users`
 * does, and that makes it a second statement of what `classified()` already says about every
 * column. This is what keeps the two from drifting: a column added next year with an erasure
 * action, or a table that starts holding somebody's rows, fails here rather than surviving every
 * erasure from then on — a GDPR Art. 17 failure nobody would notice until somebody read a row.
 *
 * The rule it holds the function to: every end-user table with something to erase is either
 * deleted from, which takes every column with it, or updated, and then the columns the update
 * clears are exactly the ones classified for erasure.
 */

/** Written by the statements to say what happened, rather than cleared by them. */
const BOOKKEEPING = new Set(["deleted_at", "updated_at", "revoked_at", "revoke_reason"]);

let deleted = new Set<string>();
let updated = new Map<string, Set<string>>();

const snake = (column: string): string => column.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const endUserTables = (): Set<string> =>
  new Set(
    [...subjectRegistry()]
      .filter(([, subject]) => subject.population === SubjectPopulation.EndUser)
      .map(([table]) => table),
  );

beforeAll(async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const drizzle = join(here, "..", "..", "..", "packages", "persistence", "drizzle");

  // Found rather than named, like the retention test: the last migration that defines the
  // function is the one that wins at runtime.
  const marker = /CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?erase_user\(/;
  let body = "";
  for (const file of (await readdir(drizzle)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(join(drizzle, file), "utf8");
    const at = sql.search(marker);
    if (at !== -1) body = sql.slice(at, sql.indexOf("$$;", at));
  }
  expect(body, "erase_user is defined by no migration").not.toBe("");

  deleted = new Set(
    [...body.matchAll(/DELETE FROM public\.(\w+)/g)].map((match) => match[1] ?? ""),
  );
  updated = new Map(
    [...body.matchAll(/UPDATE public\.(\w+) \w+ SET([\s\S]*?)\n\s*WHERE/g)].map((match) => [
      match[1] ?? "",
      new Set(
        [...(match[2] ?? "").matchAll(/^\s{4}(\w+) =/gm)]
          .map((column) => column[1] ?? "")
          .filter((column) => !BOOKKEEPING.has(column)),
      ),
    ]),
  );
});

describe("what an erasure touches", () => {
  it("reaches every end-user table that holds something to erase", () => {
    const erase = generateSubjectFields().erase;
    const missed = [...endUserTables()].filter(
      (table) => erase.has(table) && !deleted.has(table) && !updated.has(table),
    );
    expect(missed).toEqual([]);
  });

  it("clears exactly the columns classified() marks for erasure, on the tables it keeps", () => {
    const erase = generateSubjectFields().erase;
    for (const [table, cleared] of updated) {
      const expected = [...(erase.get(table)?.keys() ?? [])].map(snake);
      expect([...cleared].sort(), table).toEqual(expected.sort());
    }
  });

  it("touches no table that is not about an end user", () => {
    const allowed = endUserTables();
    const strays = [...deleted, ...updated.keys()].filter((table) => !allowed.has(table));
    expect(strays).toEqual([]);
  });
});
