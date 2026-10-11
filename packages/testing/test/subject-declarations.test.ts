import {
  classificationRegistry,
  subjectRegistry,
} from "@idenzy/compliance/classification/registry";
import { Erasure, SubjectPopulation } from "@idenzy/compliance/classification/vocabulary";
import { describe, expect, it } from "vitest";
// Importing the schema is what populates both registries, so this has to come before any read.
import "@idenzy/persistence/schema/index";

/**
 * That every table holding somebody's personal data says whose, and how to find them (4.13.6).
 *
 * The gap this closes is subtle and was the reason nothing consumed the generated field lists in
 * production. `subjectField` declares *which columns* an access request returns and `erasure`
 * declares what to do with them — and neither says how to reach one person's rows. A worker built
 * on that alone would carry a hand-written join per table, which is the maintained list that
 * generating these lists exists to abolish, reintroduced one layer down.
 *
 * It also separates two populations that must never be answered from one query. `users.email` and
 * `org_invitations.email` are both PII marked `subjectField`, and they are not the same kind of
 * person: one is a customer's end user, whose processor we are, and the other is somebody on the
 * customer's own team, who is our own data subject.
 *
 * Asserted here rather than by the compiler because the pair is split across levels: the flags are
 * per column and the subject is per table, so `classifiedTable` cannot see one from the other.
 * Same reason the `project_id` foreign-key invariant is a test.
 */

/** Tables whose columns include at least one marked as a data subject's. */
function tablesWithSubjectColumns(): string[] {
  const found: string[] = [];
  for (const [table, columns] of classificationRegistry()) {
    if (Object.values(columns).some((column) => column.subjectField === true)) found.push(table);
  }
  return found.sort();
}

/** Tables with at least one column an erasure acts on. */
function tablesWithErasureColumns(): string[] {
  const found: string[] = [];
  for (const [table, columns] of classificationRegistry()) {
    const acted = Object.values(columns).some(
      (column) =>
        column.erasure !== undefined &&
        column.erasure !== Erasure.NotApplicable &&
        column.erasure !== Erasure.RetainPseudonymous,
    );
    if (acted) found.push(table);
  }
  return found.sort();
}

describe("every table holding personal data declares whose", () => {
  it("has a subject for each table with subject columns", () => {
    const subjects = subjectRegistry();
    const undeclared = tablesWithSubjectColumns().filter((table) => !subjects.has(table));
    expect(undeclared).toEqual([]);
  });

  it("checked a meaningful number of tables, so an empty pass means something", () => {
    // Guard against the registries failing to populate, which would make the assertion above
    // trivially true over an empty list.
    expect(tablesWithSubjectColumns().length).toBeGreaterThan(10);
  });

  it("names a population this build knows", () => {
    const known: string[] = Object.values(SubjectPopulation);
    for (const [table, subject] of subjectRegistry()) {
      expect(known, table).toContain(subject.population);
    }
  });

  /**
   * A subject that cannot be located is a real answer — `otp_challenges` holds a hash of the
   * address rather than the address — but it has to be an explained one. An unexplained null is
   * indistinguishable from somebody who did not think about it.
   */
  it("explains itself wherever a subject cannot be located", () => {
    for (const [table, subject] of subjectRegistry()) {
      if (subject.locatedBy === null) {
        expect(subject.note ?? "", table).not.toBe("");
      }
    }
  });

  /**
   * Something to return or something to erase. A table of one-time codes has nothing an access
   * request would return and still has to be reached by an erasure (`erase_user` is held to the
   * end-user subjects by `user-erasure.test.ts`), so either kind of column justifies a subject.
   */
  it("declares no subject for a table holding nobody's personal data", () => {
    const reachable = new Set([...tablesWithSubjectColumns(), ...tablesWithErasureColumns()]);
    const spurious = [...subjectRegistry().keys()].filter((table) => !reachable.has(table));
    // Honest in both directions: a subject on a table with nothing to return or erase would send
    // a request somewhere there is nothing to find.
    expect(spurious).toEqual([]);
  });

  /**
   * Both populations are present, which is the point of having the distinction at all. If one
   * disappeared, every table would have been swept into the other and a request from one
   * population could reach the other's rows.
   */
  it("keeps the two populations apart and both in use", () => {
    const populations = new Set([...subjectRegistry().values()].map((s) => s.population));
    expect(populations).toEqual(
      new Set([SubjectPopulation.EndUser, SubjectPopulation.CustomerStaff]),
    );
  });

  /**
   * The one exception worth asserting by name. Erasure must not remove audit entries: the trail
   * keeps a pseudonymous id precisely so an erasure stays provable, which is how Art. 17(3)(b) is
   * reconciled with Art. 17(1). A handler that treated it like any other table would destroy the
   * evidence that it had done its job.
   */
  it("marks the audit trail as export-only", () => {
    const audit = subjectRegistry().get("audit_events");
    expect(audit?.population).toBe(SubjectPopulation.EndUser);
    expect(audit?.note ?? "").toContain("17(3)(b)");
  });
});
