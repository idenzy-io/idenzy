/**
 * Everything the import screen knows before the server is involved: which sources an
 * export can come from and what each carries, how a file is read into records, which
 * columns of those records are which fields of ours, and what an import of them would
 * do. All of it is pure and runs in the browser on the file the operator dropped, so
 * the review step is honest about the file before a byte of it is uploaded.
 *
 * The server side is `MigrationImporter` and its five subclasses (PROJECT.md 9.5), which
 * parse on a worker pool (9.6) and write through the management API. Passwords are the
 * part worth understanding: a hash in a format we can verify is stored as it is and
 * checked by a verify-only hasher (`LegacyVerifyOnlyHasher` in @idenzy/crypto), and the
 * account is rehashed to Argon2id on its first successful sign-in, so nobody is asked to
 * reset a password because their provider changed. A hash in a format we cannot verify
 * is dropped and the account signs in by a code or sets a new password instead.
 */

import { anyOf, type TimeWindow, within } from "./filters";

export type ImportSource = "firebase" | "supabase" | "auth0" | "clerk" | "cognito" | "file";

export type ImportFormat = "json" | "ndjson" | "csv";

export const FORMAT_LABELS: Record<ImportFormat, string> = {
  json: "JSON",
  ndjson: "NDJSON",
  csv: "CSV",
};

export interface SourceInfo {
  id: ImportSource;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** A mark that is solid black and would vanish on a dark surface. */
  monochrome: boolean;
  /** A colour class for a mark drawn in `currentColor`, which would otherwise be ink. */
  tint?: string;
  /** How the export is obtained. */
  how: string;
  /** What happens to passwords. */
  passwords: string;
  formats: readonly ImportFormat[];
  /** The hash the source exports, where it exports one. */
  hash: HashKind | null;
  /**
   * The short answer to what a migration from here does to passwords, for a list that
   * has room for a phrase and not a sentence. `hash` cannot answer it on its own: it is
   * null both for a source that exports no hashes at all and for a file that may carry
   * any of the four we verify.
   */
  hashes: string;
  guide: string;
}

const GUIDES = "https://idenzy.io/docs/migrate";

export const SOURCES: readonly SourceInfo[] = [
  {
    id: "firebase",
    label: "Firebase Authentication",
    icon: "logos:firebase-icon",
    monochrome: false,
    how: "Run `firebase auth:export users.json`, then copy the hash parameters from the console.",
    passwords:
      "scrypt hashes import. Sign-ins keep working, and each upgrades to Argon2id on first use.",
    formats: ["json", "csv"],
    hash: "scrypt",
    hashes: "scrypt",
    guide: `${GUIDES}/firebase`,
  },
  {
    id: "supabase",
    label: "Supabase Auth",
    icon: "logos:supabase-icon",
    monochrome: false,
    how: "Export `auth.users` from the SQL editor as CSV or JSON.",
    passwords: "bcrypt hashes import as they are.",
    formats: ["csv", "json"],
    hash: "bcrypt",
    hashes: "bcrypt",
    guide: `${GUIDES}/supabase`,
  },
  {
    id: "auth0",
    label: "Auth0",
    icon: "logos:auth0-icon",
    monochrome: true,
    how: "Create a user export job, and ask Auth0 support for the password hash export.",
    passwords:
      "bcrypt hashes import when the support export is included. Without it, users set a new password.",
    formats: ["ndjson", "json"],
    hash: "bcrypt",
    hashes: "bcrypt, on request",
    guide: `${GUIDES}/auth0`,
  },
  {
    id: "clerk",
    label: "Clerk",
    icon: "simple-icons:clerk",
    monochrome: false,
    how: "Export users from the dashboard, or list them through the Backend API with their digests.",
    passwords: "bcrypt, Argon2 and PBKDF2 digests import as they are.",
    formats: ["csv", "json"],
    hash: "bcrypt",
    hashes: "bcrypt, Argon2, PBKDF2",
    guide: `${GUIDES}/clerk`,
  },
  {
    id: "cognito",
    label: "Amazon Cognito",
    icon: "logos:aws-cognito",
    monochrome: false,
    how: "List the user pool with the AWS CLI and save the JSON.",
    passwords:
      "Cognito exports no hashes. Users set a new password, or sign in by code, on their first visit.",
    formats: ["json", "csv"],
    hash: null,
    hashes: "None exported",
    guide: `${GUIDES}/cognito`,
  },
  {
    id: "file",
    label: "CSV or JSON file",
    icon: "hugeicons:csv-01",
    monochrome: false,
    tint: "text-success",
    how: "One user per row or object, under any column names. Map them in the next step.",
    passwords:
      "bcrypt, Argon2, scrypt and PBKDF2 hashes import. Anything else asks the user for a new password.",
    formats: ["csv", "json", "ndjson"],
    hash: null,
    hashes: "Whatever the file holds",
    guide: `${GUIDES}/file`,
  },
];

export function sourceInfo(id: ImportSource): SourceInfo {
  // Every id in the union has an entry above, so the lookup cannot miss.
  return SOURCES.find((source) => source.id === id) as SourceInfo;
}

/*
 * Reading a file into records.
 */

/** From the name first, then from the first character, because exports are misnamed. */
export function detectFormat(fileName: string, text: string): ImportFormat | null {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (extension === "csv") return "csv";
  if (extension === "ndjson" || extension === "jsonl") return "ndjson";
  const head = text.trimStart();
  if (head.startsWith("[") || head.startsWith("{")) {
    return isNdjson(text) ? "ndjson" : "json";
  }
  if (extension === "json") return "json";
  return head.includes(",") ? "csv" : null;
}

/** Several lines that each parse as an object is NDJSON, whatever the name says. */
function isNdjson(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return false;
  return lines.slice(0, 3).every((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("{") && trimmed.endsWith("}");
  });
}

export type ImportRecord = Record<string, unknown>;

/**
 * The records in a file, each flattened one level so a nested export reads as columns:
 * Supabase's `raw_user_meta_data.name`, Auth0's `user_metadata.plan`, and Cognito's
 * attribute list as `attributes.email`. A Firebase export wraps its list in `users`
 * and a Cognito listing in `Users`, and both unwrap here.
 */
export type ParseResult = { ok: true; records: ImportRecord[] } | { ok: false; reason: string };

export function parseRecords(text: string, format: ImportFormat): ParseResult {
  const entries = entriesOf(text, format);
  if (entries === null) {
    return { ok: false, reason: `The file is not valid ${FORMAT_LABELS[format]}.` };
  }
  if (entries.length === 0 && format === "json") {
    return { ok: false, reason: "The file does not hold a list of users." };
  }
  const records: ImportRecord[] = [];
  for (const entry of entries) {
    if (!isPlainObject(entry)) {
      return { ok: false, reason: "Every entry in the file must be an object." };
    }
    records.push(flatten(entry));
  }
  return { ok: true, records };
}

/** The raw entries, or null where the text does not parse as the format says. */
function entriesOf(text: string, format: ImportFormat): unknown[] | null {
  try {
    if (format === "csv") return parseCsvRecords(text);
    if (format === "ndjson") {
      return text
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .map((line): unknown => JSON.parse(line));
    }
    return unwrap(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The list inside a JSON document: the document itself, or the one key that holds it. */
function unwrap(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isPlainObject(parsed)) return [];
  for (const key of ["users", "Users", "records", "data"]) {
    const list = parsed[key];
    if (Array.isArray(list)) return list;
  }
  return [parsed];
}

function isPlainObject(value: unknown): value is ImportRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flatten(record: ImportRecord): ImportRecord {
  const out: ImportRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "Attributes" && Array.isArray(value)) {
      addAttributes(out, value);
      continue;
    }
    out[key] = value;
    if (isPlainObject(value)) addNested(out, key, value);
  }
  return out;
}

/** Cognito's `{Name, Value}` list, as `attributes.<name>` columns. */
function addAttributes(out: ImportRecord, list: readonly unknown[]) {
  for (const attribute of list) {
    if (!isPlainObject(attribute)) continue;
    const name = attribute["Name"];
    if (typeof name === "string") out[`attributes.${name}`] = attribute["Value"];
  }
}

function addNested(out: ImportRecord, key: string, value: ImportRecord) {
  for (const [inner, innerValue] of Object.entries(value)) out[`${key}.${inner}`] = innerValue;
}

/** RFC 4180 as far as exports need: quoted cells, doubled quotes, newlines in quotes. */
export function parseCsv(text: string): string[][] {
  const scanner = new CsvScanner();
  for (const char of text) scanner.feed(char);
  return scanner.finish();
}

/**
 * One character at a time, with two things remembered: whether a cell is quoted, and
 * whether the last character was a quote inside one, which is either the closing
 * quote or the first half of a doubled one and cannot be told apart until the next
 * character arrives. A carriage return is a row end and swallows the line feed after it.
 */
class CsvScanner {
  private readonly rows: string[][] = [];
  private row: string[] = [];
  private cell = "";
  private quoted = false;
  private quoteSeen = false;
  private returnSeen = false;

  feed(char: string) {
    if (this.returnSeen) {
      this.returnSeen = false;
      if (char === "\n") return;
    }
    if (this.quoted) this.feedQuoted(char);
    else this.feedPlain(char);
  }

  finish(): string[][] {
    if (this.cell !== "" || this.row.length > 0) this.endRow();
    return this.rows.filter((entry) => entry.some((value) => value.trim() !== ""));
  }

  private feedPlain(char: string) {
    if (char === '"') this.quoted = true;
    else if (char === ",") this.endCell();
    else if (char === "\n" || char === "\r") {
      this.returnSeen = char === "\r";
      this.endRow();
    } else this.cell += char;
  }

  private feedQuoted(char: string) {
    if (this.quoteSeen) {
      this.quoteSeen = false;
      if (char === '"') {
        this.cell += '"';
        return;
      }
      this.quoted = false;
      this.feedPlain(char);
      return;
    }
    if (char === '"') this.quoteSeen = true;
    else this.cell += char;
  }

  private endCell() {
    this.row.push(this.cell);
    this.cell = "";
  }

  private endRow() {
    this.endCell();
    this.rows.push(this.row);
    this.row = [];
  }
}

function parseCsvRecords(text: string): ImportRecord[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((key) => key.trim());
  return rows.map((row) => {
    const record: ImportRecord = {};
    keys.forEach((key, index) => {
      const value = row[index] ?? "";
      record[key] = value === "" ? null : value;
    });
    return record;
  });
}

/*
 * Which columns are which fields.
 */

export type Field =
  | "email"
  | "emailVerified"
  | "phone"
  | "phoneVerified"
  | "displayName"
  | "avatarUrl"
  | "passwordHash"
  | "passwordSalt"
  | "externalId"
  | "createdAt"
  | "metadata";

export interface FieldInfo {
  key: Field;
  label: string;
  hint: string;
}

export const FIELDS: readonly FieldInfo[] = [
  {
    key: "email",
    label: "Email",
    hint: "The address they sign in with. This or a phone is needed.",
  },
  { key: "emailVerified", label: "Email verified", hint: "true, 1, yes or a timestamp counts." },
  { key: "phone", label: "Phone", hint: "International form: +14155550123." },
  { key: "phoneVerified", label: "Phone verified", hint: "As for email." },
  { key: "displayName", label: "Display name", hint: "" },
  { key: "avatarUrl", label: "Avatar URL", hint: "" },
  {
    key: "passwordHash",
    label: "Password hash",
    hint: "Kept as it is where the format is one we verify.",
  },
  {
    key: "passwordSalt",
    label: "Password salt",
    hint: "Only where the salt is kept apart, as Firebase keeps it.",
  },
  {
    key: "externalId",
    label: "External ID",
    hint: "Kept in metadata, as the id the source knew them by.",
  },
  { key: "createdAt", label: "Created", hint: "Kept as the account's creation date." },
  {
    key: "metadata",
    label: "Public metadata",
    hint: "A JSON object, or a column kept under its own key.",
  },
];

/** Which source column feeds each field. Absent means the field is not imported. */
export type Mapping = Partial<Record<Field, string>>;

/**
 * The names each field goes by across the sources, folded the way `foldKey` folds a
 * column name. Order matters within a field: the first alias found wins, so the exact
 * name sits before the loose one.
 */
const ALIASES: Record<Field, readonly string[]> = {
  email: ["email", "emailaddress", "primaryemailaddress", "attributes.email", "useremail", "mail"],
  emailVerified: [
    "emailverified",
    "emailconfirmedat",
    "attributes.emailverified",
    "emailverifiedat",
    "verified",
  ],
  phone: ["phone", "phonenumber", "attributes.phonenumber", "mobile", "primaryphonenumber"],
  phoneVerified: ["phoneverified", "phoneconfirmedat", "attributes.phonenumberverified"],
  displayName: ["displayname", "name", "fullname", "attributes.name", "firstname", "nickname"],
  avatarUrl: ["photourl", "avatarurl", "picture", "imageurl", "profileimageurl", "avatar"],
  passwordHash: [
    "passwordhash",
    "encryptedpassword",
    "passworddigest",
    "custompasswordhash",
    "password",
    "hash",
  ],
  passwordSalt: ["salt", "passwordsalt"],
  externalId: ["localid", "userid", "uid", "sub", "username", "id"],
  createdAt: ["createdat", "usercreatedate", "created", "createdon"],
  metadata: [
    "usermetadata",
    "rawusermetadata",
    "publicmetadata",
    "unsafemetadata",
    "custommetadata",
    "metadata",
    "customattributes",
  ],
};

/** `Email_Address`, `email-address` and `emailAddress` are one name. Dots stay. */
export function foldKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

export function inferMapping(keys: readonly string[]): Mapping {
  const folded = new Map(keys.map((key) => [foldKey(key), key]));
  const mapping: Mapping = {};
  for (const field of FIELDS) {
    const match = ALIASES[field.key].find((alias) => folded.has(alias));
    if (match !== undefined) mapping[field.key] = folded.get(match);
  }
  return mapping;
}

/**
 * Which product wrote the file, from the shape of its records. Each export has a column
 * no other has, and finding it is worth more than trusting the source the operator
 * chose, because the wrong choice would read passwords under the wrong hash.
 */
export function detectSource(records: readonly ImportRecord[]): ImportSource | null {
  const first = records[0];
  if (!first) return null;
  const keys = new Set(Object.keys(first).map(foldKey));
  const id = String(first["user_id"] ?? first["id"] ?? "");
  if (keys.has("localid") && (keys.has("passwordhash") || keys.has("salt"))) return "firebase";
  if (keys.has("encryptedpassword") || keys.has("rawusermetadata")) return "supabase";
  if (id.startsWith("auth0|") || (keys.has("identities") && keys.has("emailverified")))
    return "auth0";
  if (keys.has("passworddigest") || keys.has("passwordhasher")) return "clerk";
  if (keys.has("userstatus") || keys.has("attributes.email")) return "cognito";
  return null;
}

/*
 * Password hashes.
 */

export type HashKind =
  | "bcrypt"
  | "argon2"
  | "scrypt"
  | "pbkdf2"
  | "md5"
  | "sha1"
  | "sha256"
  | "unknown";

export const HASH_LABELS: Record<HashKind, string> = {
  bcrypt: "bcrypt",
  argon2: "Argon2",
  scrypt: "scrypt",
  pbkdf2: "PBKDF2",
  md5: "MD5",
  sha1: "SHA-1",
  sha256: "SHA-256",
  unknown: "Unrecognised",
};

/**
 * Whether a verify-only hasher exists for the format (PROJECT.md 9.5). The unsalted
 * digests are refused on purpose: verifying against them would keep a credential a
 * leak of the source's table already broke.
 */
export const HASH_IMPORTABLE: Record<HashKind, boolean> = {
  bcrypt: true,
  argon2: true,
  scrypt: true,
  pbkdf2: true,
  md5: false,
  sha1: false,
  sha256: false,
  unknown: false,
};

const HASH_SHAPES: readonly [RegExp, HashKind][] = [
  [/^\$2[aby]\$\d{2}\$/, "bcrypt"],
  [/^\$argon2(?:id|i|d)\$/, "argon2"],
  [/^\$(?:pbkdf2|pbkdf2-sha\d+)\$/, "pbkdf2"],
  [/^pbkdf2_sha\d+\$/, "pbkdf2"],
  [/^\$(?:s0|scrypt)\$/, "scrypt"],
  [/^[a-f0-9]{32}$/i, "md5"],
  [/^[a-f0-9]{40}$/i, "sha1"],
  [/^[a-f0-9]{64}$/i, "sha256"],
];

/**
 * A Firebase export writes the scrypt digest as bare base64 with the salt beside it, so
 * base64 of the right length is scrypt when the file is Firebase's and unknown anywhere
 * else, where it could be anything at all.
 */
export function classifyHash(value: string, source: ImportSource | null): HashKind {
  const hash = value.trim();
  for (const [shape, kind] of HASH_SHAPES) {
    if (shape.test(hash)) return kind;
  }
  if (source === "firebase" && /^[A-Za-z0-9+/]{40,}={0,2}$/.test(hash)) return "scrypt";
  return "unknown";
}

/*
 * What the import would do.
 */

export type Issue =
  | "missing_identifier"
  | "invalid_email"
  | "invalid_phone"
  | "duplicate_email"
  | "unsupported_hash";

export const ISSUE_LABELS: Record<Issue, string> = {
  missing_identifier: "No email or phone",
  invalid_email: "Email is not an address",
  invalid_phone: "Phone is not in international form",
  duplicate_email: "Same email as an earlier row",
  unsupported_hash: "Password hash in a format we cannot verify",
};

/** Issues that stop a row. The rest are noted and the row still imports. */
export const BLOCKING_ISSUES: readonly Issue[] = [
  "missing_identifier",
  "invalid_email",
  "duplicate_email",
];

export interface ImportRow {
  /** One-based, as the operator sees it in their file. */
  line: number;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  displayName: string | null;
  hash: HashKind | null;
  issues: Issue[];
}

export interface ImportAnalysis {
  total: number;
  /** Rows with no blocking issue. */
  importable: number;
  withEmail: number;
  verifiedEmails: number;
  withPhone: number;
  /** Rows whose hash imports, by format. */
  passwordsKept: Partial<Record<HashKind, number>>;
  passwordsKeptTotal: number;
  /** Rows with a hash we cannot verify: the account starts without a password. */
  passwordsDropped: number;
  /** Rows with no hash at all. */
  withoutPassword: number;
  issues: Partial<Record<Issue, number>>;
  rows: ImportRow[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

export function readField(record: ImportRecord, mapping: Mapping, field: Field): unknown {
  const column = mapping[field];
  if (column === undefined) return undefined;
  return record[column];
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** The ways an export says yes: a boolean, a 1, a word, or the moment it happened. */
export function truthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "verified", "confirmed"].includes(text)) return true;
  return /^\d{4}-\d{2}-\d{2}/.test(text) || /^\d{10,13}$/.test(text);
}

export function analyse(
  records: readonly ImportRecord[],
  mapping: Mapping,
  source: ImportSource | null,
): ImportAnalysis {
  const seen = new Set<string>();
  const rows = records.map((record, index) => readRow(record, mapping, source, index + 1, seen));
  return summarise(rows);
}

function readRow(
  record: ImportRecord,
  mapping: Mapping,
  source: ImportSource | null,
  line: number,
  seen: Set<string>,
): ImportRow {
  const email = asText(readField(record, mapping, "email"))?.toLowerCase() ?? null;
  const phone = asText(readField(record, mapping, "phone"))?.replace(/[\s()-]/g, "") ?? null;
  const hashText = asText(readField(record, mapping, "passwordHash"));
  const hash = hashText === null ? null : classifyHash(hashText, source);
  return {
    line,
    email,
    emailVerified: email !== null && truthy(readField(record, mapping, "emailVerified")),
    phone,
    phoneVerified: phone !== null && truthy(readField(record, mapping, "phoneVerified")),
    displayName: asText(readField(record, mapping, "displayName")),
    hash,
    issues: issuesOf(email, phone, hash, seen),
  };
}

/** `seen` is the addresses of the rows before this one, and this one's is added. */
function issuesOf(
  email: string | null,
  phone: string | null,
  hash: HashKind | null,
  seen: Set<string>,
): Issue[] {
  const issues: Issue[] = [];
  if (email === null && phone === null) issues.push("missing_identifier");
  if (email !== null && !EMAIL.test(email)) issues.push("invalid_email");
  if (phone !== null && !E164.test(phone)) issues.push("invalid_phone");
  if (email !== null && EMAIL.test(email)) {
    if (seen.has(email)) issues.push("duplicate_email");
    seen.add(email);
  }
  if (hash !== null && !HASH_IMPORTABLE[hash]) issues.push("unsupported_hash");
  return issues;
}

function summarise(rows: readonly ImportRow[]): ImportAnalysis {
  const analysis: ImportAnalysis = {
    total: rows.length,
    importable: 0,
    withEmail: 0,
    verifiedEmails: 0,
    withPhone: 0,
    passwordsKept: {},
    passwordsKeptTotal: 0,
    passwordsDropped: 0,
    withoutPassword: 0,
    issues: {},
    rows: [...rows],
  };
  for (const row of rows) {
    const blocked = row.issues.some((issue) => BLOCKING_ISSUES.includes(issue));
    if (!blocked) analysis.importable += 1;
    if (row.email !== null) analysis.withEmail += 1;
    if (row.emailVerified) analysis.verifiedEmails += 1;
    if (row.phone !== null) analysis.withPhone += 1;
    countPassword(analysis, row);
    for (const issue of row.issues) analysis.issues[issue] = (analysis.issues[issue] ?? 0) + 1;
  }
  return analysis;
}

function countPassword(analysis: ImportAnalysis, row: ImportRow) {
  if (row.hash === null) {
    analysis.withoutPassword += 1;
  } else if (HASH_IMPORTABLE[row.hash]) {
    analysis.passwordsKept[row.hash] = (analysis.passwordsKept[row.hash] ?? 0) + 1;
    analysis.passwordsKeptTotal += 1;
  } else {
    analysis.passwordsDropped += 1;
  }
}

/** The rows that were refused, as a file the operator can fix and send again. */
export function issuesToCsv(rows: readonly ImportRow[]): string {
  const header = ["line", "email", "phone", "issues"];
  const lines = rows
    .filter((row) => row.issues.length > 0)
    .map((row) =>
      [row.line, row.email, row.phone, row.issues.map((issue) => ISSUE_LABELS[issue]).join("; ")]
        .map((value) => {
          const text = value === null ? "" : String(value);
          return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    );
  return [header.join(","), ...lines].join("\r\n");
}

/**
 * The Firebase hash parameters, which the export leaves out: they belong to the
 * project, not the user, and the console shows them once under "Password hash
 * parameters". Without them a scrypt digest cannot be verified at all.
 */
export interface FirebaseHashConfig {
  signerKey: string;
  saltSeparator: string;
  rounds: number;
  memoryCost: number;
}

export const EMPTY_FIREBASE_HASH_CONFIG: FirebaseHashConfig = {
  signerKey: "",
  saltSeparator: "Bw==",
  rounds: 8,
  memoryCost: 14,
};

export function firebaseHashConfigComplete(config: FirebaseHashConfig): boolean {
  return (
    config.signerKey.trim() !== "" &&
    config.saltSeparator.trim() !== "" &&
    Number.isInteger(config.rounds) &&
    config.rounds > 0 &&
    Number.isInteger(config.memoryCost) &&
    config.memoryCost > 0
  );
}

/*
 * The history: a job as the panel sees it, and the rules that narrow a list of them.
 *
 * The type lives here rather than in the store for the reason `SessionRow` does: the
 * store is one source of these rows and the management API will be another, and the
 * rules over them are pure and tested either way.
 */

export type ImportStatus = "queued" | "running" | "done" | "failed";

export interface ImportError {
  line: number;
  email: string | null;
  reason: string;
}

export interface ImportJob {
  id: string;
  projectId: string;
  source: ImportSource;
  fileName: string;
  format: ImportFormat;
  /** A rehearsal: everything checked, nothing written. */
  dryRun: boolean;
  rows: number;
  imported: number;
  /** Rows left out on purpose: a duplicate of an earlier row. */
  skipped: number;
  /** Rows refused: no identifier, or one that is not an address. */
  failed: number;
  passwordsKept: number;
  passwordsDropped: number;
  /** How many of the kept passwords have since been rehashed on a sign-in. */
  passwordsUpgraded: number;
  status: ImportStatus;
  /** 0 to 1 while running. */
  progress: number;
  startedAt: string;
  finishedAt: string | null;
  startedBy: string;
  errors: ImportError[];
}

/**
 * What a job's badge says. A finished dry run reads "Dry run" rather than "Done",
 * because the two ran the same checks and only one of them wrote anything, and a
 * rehearsal that reads like the real thing is one that gets run twice.
 *
 * One function, so the run card and the history table cannot draw the same job two
 * ways, and one value, so the label and the colour are read off the same key.
 */
export type ImportOutcome = ImportStatus | "dry-run";

export const IMPORT_OUTCOME_LABELS: Record<ImportOutcome, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  "dry-run": "Dry run",
};

export function importOutcome(job: ImportJob): ImportOutcome {
  return job.dryRun && job.status === "done" ? "dry-run" : job.status;
}

export const IMPORT_OUTCOMES: readonly ImportOutcome[] = [
  "done",
  "dry-run",
  "running",
  "queued",
  "failed",
];

/**
 * A rehearsal or a real run. It is the one cut that puts every job in exactly one
 * place whatever it is doing, which is what a set of tabs over a list has to be: a
 * running job belongs to the kind it will be when it finishes, and does not vanish
 * from every tab until it does.
 */
export type ImportKind = "import" | "dry-run";

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  import: "Imports",
  "dry-run": "Dry runs",
};

export function importKind(job: ImportJob): ImportKind {
  return job.dryRun ? "dry-run" : "import";
}

export interface ImportFilters {
  kind: "all" | ImportKind;
  query: string;
  /** Keep a job from any one of these sources. Empty keeps everything. */
  sources: readonly ImportSource[];
  outcomes: readonly ImportOutcome[];
  started: TimeWindow;
}

export const EMPTY_IMPORT_FILTERS: ImportFilters = {
  kind: "all",
  query: "",
  sources: [],
  outcomes: [],
  started: "any",
};

/**
 * How many of the filters behind the Filter button are set. The tabs and the search box
 * are controls of their own and show their own state, so neither is counted.
 */
export function importFilterCount(filters: ImportFilters): number {
  let count = 0;
  if (filters.sources.length > 0) count += 1;
  if (filters.outcomes.length > 0) count += 1;
  if (filters.started !== "any") count += 1;
  return count;
}

/**
 * Whether a search term names this job. Over the file as it was named, whoever ran it
 * and the job's own id, which are the three things somebody arrives holding: a file
 * name from a colleague, an address from the audit log, an id from a support thread.
 */
export function matchesImportQuery(job: ImportJob, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (term === "") return true;
  const fields = [job.fileName, job.startedBy, job.id, sourceInfo(job.source).label];
  return fields.some((field) => field.toLowerCase().includes(term));
}

type KeepImport = (job: ImportJob, filters: ImportFilters, now: Date) => boolean;

/** One rule per filter; a job stays while every rule keeps it. */
const IMPORT_RULES: readonly KeepImport[] = [
  (job, filters) => filters.kind === "all" || importKind(job) === filters.kind,
  (job, filters) => matchesImportQuery(job, filters.query),
  (job, filters) => anyOf(filters.sources, job.source),
  (job, filters) => anyOf(filters.outcomes, importOutcome(job)),
  (job, filters, now) => within(job.startedAt, filters.started, now),
];

export function filterImports(
  jobs: readonly ImportJob[],
  filters: ImportFilters,
  now: Date,
): ImportJob[] {
  return jobs.filter((job) => IMPORT_RULES.every((keep) => keep(job, filters, now)));
}

/** How many jobs sit under each tab, plus the total the "All" tab shows. */
export function countImportsByKind(jobs: readonly ImportJob[]): Record<"all" | ImportKind, number> {
  const counts = { all: jobs.length, import: 0, "dry-run": 0 };
  for (const job of jobs) counts[importKind(job)] += 1;
  return counts;
}
