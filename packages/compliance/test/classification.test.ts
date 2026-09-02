import { getTableColumns } from "drizzle-orm";
import { text, uuid } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { classified, classifiedTable, encrypted } from "../src/classification/classified.js";
import { classificationRegistry, resetRegistryForTesting } from "../src/classification/registry.js";
import { DataClass, Erasure, Purpose, Retention } from "../src/classification/vocabulary.js";
import { generateDataMap } from "../src/generators/data-map.js";
import { forbiddenLogFields, generateLogAllowlist } from "../src/generators/log-allowlist.js";
import { generateRopa } from "../src/generators/ropa.js";
import { generateSubjectFields } from "../src/generators/subject-fields.js";

beforeEach(() => {
  resetRegistryForTesting();
});

function buildSampleTable() {
  return classifiedTable("sample_users", {
    id: classified(uuid("id").primaryKey(), {
      class: DataClass.Pseudonymous,
      purpose: Purpose.Authentication,
      retention: Retention.UntilAccountDeletion,
      erasure: Erasure.RetainPseudonymous,
      loggable: true,
    }),
    email: classified(text("email"), {
      class: DataClass.Pii,
      purpose: Purpose.Authentication,
      retention: Retention.UntilAccountDeletion,
      subjectField: true,
      erasure: Erasure.Tombstone,
    }),
    passwordHash: classified(text("password_hash"), {
      class: DataClass.Secret,
      purpose: Purpose.Authentication,
      retention: Retention.UntilAccountDeletion,
      erasure: Erasure.NullOut,
    }),
    totpSecret: encrypted(text("totp_secret"), {
      class: DataClass.Secret,
      purpose: Purpose.Authentication,
      retention: Retention.UntilAccountDeletion,
      erasure: Erasure.NullOut,
    }),
  });
}

describe("classifiedTable", () => {
  it("builds a working drizzle table", () => {
    const table = buildSampleTable();
    expect(Object.keys(getTableColumns(table)).sort()).toEqual([
      "email",
      "id",
      "passwordHash",
      "totpSecret",
    ]);
  });

  it("registers every column", () => {
    buildSampleTable();
    const columns = classificationRegistry().get("sample_users");
    expect(Object.keys(columns ?? {})).toHaveLength(4);
    expect(columns?.email?.class).toBe(DataClass.Pii);
  });

  it("marks encrypted() columns as encrypted", () => {
    buildSampleTable();
    expect(classificationRegistry().get("sample_users")?.totpSecret?.encrypted).toBe(true);
  });
});

describe("generated artifacts", () => {
  it("logs only what opted in, and never pii or secrets", () => {
    buildSampleTable();
    const allowed = generateLogAllowlist();
    expect(allowed.has("id")).toBe(true);
    expect(allowed.has("email")).toBe(false);
    expect(allowed.has("passwordHash")).toBe(false);

    const forbidden = forbiddenLogFields();
    for (const field of forbidden) {
      expect(allowed.has(field)).toBe(false);
    }
  });

  it("derives the DSR export list from subjectField", () => {
    buildSampleTable();
    const fields = generateSubjectFields();
    expect(fields.export.get("sample_users")).toEqual(["email"]);
  });

  it("derives erasure actions, skipping columns that are retained", () => {
    buildSampleTable();
    const { erase } = generateSubjectFields();
    const actions = erase.get("sample_users");
    expect(actions?.get("email")).toBe(Erasure.Tombstone);
    expect(actions?.get("passwordHash")).toBe(Erasure.NullOut);
    expect(actions?.has("id")).toBe(false);
  });

  it("produces a deterministic data map", () => {
    buildSampleTable();
    expect(generateDataMap()).toBe(generateDataMap());
    expect(generateDataMap()).toContain("`sample_users`");
    expect(generateDataMap()).toContain("Do not edit");
  });

  it("excludes non-personal columns from the RoPA", () => {
    buildSampleTable();
    const ropa = generateRopa();
    expect(ropa).toContain("art_6_1_b_contract");
    expect(ropa).toContain("pii: email");
    expect(ropa).not.toContain("passwordHash");
  });
});
