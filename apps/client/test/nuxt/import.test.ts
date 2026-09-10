import { describe, expect, it } from "vitest";
import {
  analyse,
  classifyHash,
  detectFormat,
  detectSource,
  EMPTY_FIREBASE_HASH_CONFIG,
  firebaseHashConfigComplete,
  foldKey,
  type ImportFormat,
  type ImportRecord,
  inferMapping,
  issuesToCsv,
  parseCsv,
  parseRecords,
  truthy,
} from "../../app/utils/import";

const FIREBASE = JSON.stringify({
  users: [
    {
      localId: "abc",
      email: "Nuray@Example.com",
      emailVerified: true,
      passwordHash: "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2==",
      salt: "c2FsdA==",
      displayName: "Nuray Aksoy",
    },
    { localId: "def", email: "james@example.com", emailVerified: false },
  ],
});

const SUPABASE_CSV = [
  "id,email,encrypted_password,email_confirmed_at,phone,raw_user_meta_data",
  '1,a@example.com,$2a$10$abcdefghijklmnopqrstuv,2026-01-02T00:00:00Z,,"{""name"":""Ada""}"',
  "2,b@example.com,,,+14155550123,",
  "3,a@example.com,$2a$10$abcdefghijklmnopqrstuv,,,",
].join("\n");

const COGNITO = JSON.stringify({
  Users: [
    {
      Username: "u1",
      UserStatus: "CONFIRMED",
      Attributes: [
        { Name: "email", Value: "c@example.com" },
        { Name: "email_verified", Value: "true" },
      ],
    },
  ],
});

/** The records of a file the test expects to parse. */
function recordsOf(text: string, format: ImportFormat): ImportRecord[] {
  const parsed = parseRecords(text, format);
  expect(parsed.ok).toBe(true);
  return parsed.ok ? parsed.records : [];
}

describe("detectFormat", () => {
  it("trusts the extension, then the first character", () => {
    expect(detectFormat("users.csv", "a,b")).toBe("csv");
    expect(detectFormat("users.jsonl", "{}")).toBe("ndjson");
    expect(detectFormat("export.txt", "[{}]")).toBe("json");
    expect(detectFormat("export.txt", '{"a":1}\n{"a":2}')).toBe("ndjson");
    expect(detectFormat("export.txt", "email,name")).toBe("csv");
    expect(detectFormat("notes.txt", "hello")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("keeps quoted commas, doubled quotes and CRLF rows", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });

  it("keeps a newline inside quotes", () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([["a"], ["line one\nline two"]]);
  });

  it("drops blank lines", () => {
    expect(parseCsv("a,b\n\n1,2\n   ,\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseRecords", () => {
  it("unwraps a Firebase export", () => {
    const records = recordsOf(FIREBASE, "json");
    expect(records).toHaveLength(2);
    expect(records[0]?.["localId"]).toBe("abc");
  });

  it("reads CSV rows into records with empty cells as null", () => {
    const records = recordsOf(SUPABASE_CSV, "csv");
    expect(records[1]?.["encrypted_password"]).toBeNull();
    expect(records[1]?.["phone"]).toBe("+14155550123");
  });

  it("flattens a Cognito attribute list into dotted columns", () => {
    const [record] = recordsOf(COGNITO, "json");
    expect(record?.["attributes.email"]).toBe("c@example.com");
    expect(record?.["attributes.email_verified"]).toBe("true");
  });

  it("flattens one level of nesting", () => {
    const [record] = recordsOf('{"email":"x@y.z","user_metadata":{"plan":"pro"}}', "ndjson");
    expect(record?.["user_metadata.plan"]).toBe("pro");
  });

  it("says why a file cannot be read", () => {
    expect(parseRecords("42", "json")).toEqual({
      ok: false,
      reason: "The file does not hold a list of users.",
    });
    expect(parseRecords("[1,2]", "json")).toEqual({
      ok: false,
      reason: "Every entry in the file must be an object.",
    });
    expect(parseRecords("{not json", "json")).toEqual({
      ok: false,
      reason: "The file is not valid JSON.",
    });
  });
});

describe("detectSource", () => {
  it("names the product from the columns only it writes", () => {
    expect(detectSource(recordsOf(FIREBASE, "json"))).toBe("firebase");
    expect(detectSource(recordsOf(SUPABASE_CSV, "csv"))).toBe("supabase");
    expect(detectSource(recordsOf(COGNITO, "json"))).toBe("cognito");
    expect(detectSource([{ user_id: "auth0|123", email: "x@y.z" }])).toBe("auth0");
    expect(detectSource([{ id: "user_1", password_digest: "$2b$10$x" }])).toBe("clerk");
    expect(detectSource([{ email: "x@y.z" }])).toBeNull();
    expect(detectSource([])).toBeNull();
  });
});

describe("inferMapping", () => {
  it("folds column names and takes the first alias it finds", () => {
    expect(foldKey("Email_Address")).toBe("emailaddress");
    const mapping = inferMapping([
      "id",
      "email",
      "encrypted_password",
      "email_confirmed_at",
      "phone",
      "raw_user_meta_data",
    ]);
    expect(mapping).toEqual({
      email: "email",
      emailVerified: "email_confirmed_at",
      phone: "phone",
      passwordHash: "encrypted_password",
      externalId: "id",
      metadata: "raw_user_meta_data",
    });
  });

  it("reads Cognito's dotted attributes", () => {
    const mapping = inferMapping([
      "Username",
      "UserStatus",
      "attributes.email",
      "attributes.email_verified",
    ]);
    expect(mapping.email).toBe("attributes.email");
    expect(mapping.emailVerified).toBe("attributes.email_verified");
    expect(mapping.externalId).toBe("Username");
  });
});

describe("classifyHash", () => {
  it("knows the shapes we verify and the digests we refuse", () => {
    expect(classifyHash("$2b$12$abcdefghijklmnopqrstuv", null)).toBe("bcrypt");
    expect(classifyHash("$argon2id$v=19$m=65536,t=3,p=1$salt$digest", null)).toBe("argon2");
    expect(classifyHash("$pbkdf2-sha256$29000$salt$digest", null)).toBe("pbkdf2");
    expect(classifyHash("pbkdf2_sha256$600000$salt$digest", null)).toBe("pbkdf2");
    expect(classifyHash("5d41402abc4b2a76b9719d911017c592", null)).toBe("md5");
    expect(classifyHash("a".repeat(40), null)).toBe("sha1");
    expect(classifyHash("a".repeat(64), null)).toBe("sha256");
    expect(classifyHash("what is this", null)).toBe("unknown");
  });

  it("reads bare base64 as scrypt only in a Firebase file", () => {
    const digest = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2==";
    expect(classifyHash(digest, "firebase")).toBe("scrypt");
    expect(classifyHash(digest, "file")).toBe("unknown");
  });
});

describe("truthy", () => {
  it("reads the ways an export says yes", () => {
    expect(truthy(true)).toBe(true);
    expect(truthy("TRUE")).toBe(true);
    expect(truthy("1")).toBe(true);
    expect(truthy("2026-01-02T00:00:00Z")).toBe(true);
    expect(truthy("1700000000000")).toBe(true);
    expect(truthy("false")).toBe(false);
    expect(truthy(null)).toBe(false);
    expect(truthy("")).toBe(false);
  });
});

describe("analyse", () => {
  it("counts what the import would do to a Supabase export", () => {
    const records = recordsOf(SUPABASE_CSV, "csv");
    const found = analyse(records, inferMapping(Object.keys(records[0] ?? {})), "supabase");
    expect(found.total).toBe(3);
    expect(found.importable).toBe(2);
    expect(found.withEmail).toBe(3);
    expect(found.verifiedEmails).toBe(1);
    expect(found.withPhone).toBe(1);
    expect(found.passwordsKept).toEqual({ bcrypt: 2 });
    expect(found.withoutPassword).toBe(1);
    expect(found.issues).toEqual({ duplicate_email: 1 });
    expect(found.rows[2]?.issues).toEqual(["duplicate_email"]);
  });

  it("refuses a row with no identifier and notes an unsupported hash without refusing it", () => {
    const found = analyse(
      [
        { email: null, phone: null, hash: "$2b$10$x" },
        { email: "ok@example.com", phone: "0415 555", hash: "5d41402abc4b2a76b9719d911017c592" },
        { email: "not-an-address", phone: null, hash: null },
      ],
      { email: "email", phone: "phone", passwordHash: "hash" },
      "file",
    );
    expect(found.importable).toBe(1);
    expect(found.passwordsDropped).toBe(1);
    expect(found.issues).toEqual({
      missing_identifier: 1,
      invalid_phone: 1,
      unsupported_hash: 1,
      invalid_email: 1,
    });
  });

  it("folds emails to lower case so duplicates are found across cases", () => {
    const found = analyse(
      [{ email: "A@Example.com" }, { email: "a@example.com" }],
      { email: "email" },
      "file",
    );
    expect(found.issues).toEqual({ duplicate_email: 1 });
    expect(found.rows[0]?.email).toBe("a@example.com");
  });

  it("writes the refused rows as a report", () => {
    const found = analyse(
      [{ email: "bad" }, { email: "fine@example.com" }],
      { email: "email" },
      "file",
    );
    const csv = issuesToCsv(found.rows);
    expect(csv.split("\r\n")).toEqual([
      "line,email,phone,issues",
      "1,bad,,Email is not an address",
    ]);
  });
});

describe("firebaseHashConfigComplete", () => {
  it("needs a signer key and positive integer costs", () => {
    expect(firebaseHashConfigComplete(EMPTY_FIREBASE_HASH_CONFIG)).toBe(false);
    expect(firebaseHashConfigComplete({ ...EMPTY_FIREBASE_HASH_CONFIG, signerKey: "abc" })).toBe(
      true,
    );
    expect(
      firebaseHashConfigComplete({ ...EMPTY_FIREBASE_HASH_CONFIG, signerKey: "abc", rounds: 0 }),
    ).toBe(false);
  });
});
