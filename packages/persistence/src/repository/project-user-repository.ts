import {
  and,
  count,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { identities, users } from "../schema/identity.js";
import { mfaFactors, webauthnCredentials } from "../schema/mfa.js";
import { sessions } from "../schema/sessions.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/**
 * A way into an account. Derived from what exists, never stored.
 *
 * The provider half is the provider's own id — `google`, `github` — rather than a generic
 * `oauth`, because "this person signs in with GitHub" is the fact a support screen needs
 * and collapsing eighteen providers into one word throws it away.
 */
export type SignInMethod = string;

export interface ProjectUserRow {
  readonly id: string;
  readonly projectId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly phone: string | null;
  readonly phoneVerified: boolean;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly methods: readonly SignInMethod[];
  readonly mfaEnabled: boolean;
  readonly activeSessions: number;
  readonly bannedUntil: Date | null;
  readonly lastSignInAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly metadataPublic: Readonly<Record<string, unknown>>;
}

export interface ProjectUserPage {
  readonly users: readonly ProjectUserRow[];
  /** The `createdAt`/`id` of the last row, when there may be more. */
  readonly nextCursor: string | null;
}

export interface ListOptions {
  readonly search?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

/**
 * The users of one project, shaped for an operator rather than for the account's owner
 * (PROJECT.md 3.2).
 *
 * Separate from `UserRepository` on purpose. That one sits on the authentication path and
 * every method it has is a primary-key or unique-index lookup, which is what keeps sign-in
 * cheap; this one scans, sorts, counts and joins, and putting the two in one class would
 * invite somebody to reach for a list query from inside a sign-in.
 *
 * What the screen shows is assembled here rather than in the service because three of the
 * columns are not columns. `methods` comes from what exists — a password hash, linked
 * identities, a resident credential — `mfaEnabled` from an enrolled factor, and
 * `activeSessions` from a count with the same predicate the session guard applies. Deriving
 * them in TypeScript would mean four round trips per page of fifty.
 */
export class ProjectUserRepository extends BaseRepository<typeof users> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, users);
  }

  /**
   * A page of users, newest first.
   *
   * Keyset pagination on `(created_at, id)` rather than an offset. The list is ordered by
   * creation and a busy project inserts while somebody is reading, so an offset skips one
   * row for every account created behind the reader — silently, and only under load, which
   * is the worst way to find out. The id breaks ties, because `created_at` collides.
   */
  async list(options: ListOptions): Promise<ProjectUserPage> {
    const predicates = [this.tenantScope()];

    const search = options.search?.trim();
    if (search !== undefined && search.length > 0) {
      const pattern = `%${escapeLike(search)}%`;
      // Three columns because a support person is handed whichever one the customer knew.
      const match = or(
        ilike(users.email, pattern),
        ilike(users.phone, pattern),
        ilike(users.displayName, pattern),
      );
      if (match !== undefined) predicates.push(match);
    }

    const cursor = decodeCursor(options.cursor);
    if (cursor !== null) {
      const after = or(
        lt(users.createdAt, cursor.createdAt),
        and(eq(users.createdAt, cursor.createdAt), lt(users.id, cursor.id)),
      );
      if (after !== undefined) predicates.push(after);
    }

    // One extra row, so "is there another page" is answered without a second count query.
    const limit = options.limit;
    const rows = await this.tx
      .select()
      .from(users)
      .where(and(...predicates))
      .orderBy(sql`${users.createdAt} desc`, sql`${users.id} desc`)
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last !== undefined ? encodeCursor(last.createdAt, last.id) : null;

    return { users: await this.decorate(page), nextCursor };
  }

  async findById(id: string): Promise<ProjectUserRow | null> {
    const [row] = await this.tx
      .select()
      .from(users)
      .where(and(this.tenantScope(), eq(users.id, id)))
      .limit(1);
    if (row === undefined) return null;
    const [decorated] = await this.decorate([row]);
    return decorated ?? null;
  }

  /**
   * Suspends until an instant, or lifts a suspension with null.
   *
   * The write is one statement and the read-back is the same statement's `returning`,
   * because a suspension that reported success from a row nobody re-read is how a screen
   * comes to show a state the database does not have.
   *
   * A tombstoned row is refused by the predicate rather than by a check above it: erasure
   * is final, and suspending somebody who has been erased would write to a row whose
   * personal columns are already gone.
   */
  async setBannedUntil(id: string, until: Date | null): Promise<ProjectUserRow | null> {
    const [row] = await this.tx
      .update(users)
      .set({ bannedUntil: until, updatedAt: new Date() })
      .where(and(this.tenantScope(), eq(users.id, id), isNull(users.deletedAt)))
      .returning();
    if (row === undefined) return null;
    const [decorated] = await this.decorate([row]);
    return decorated ?? null;
  }

  /**
   * The project predicate for a table that is not this repository's own.
   *
   * `tenantScope()` names `users.project_id`, which is right for every query above and
   * wrong for all four below — it produced `"users"."project_id" = $1` against `identities`
   * and Postgres refused the statement. Row policies used to scope these reads whatever this
   * said; with none left it is the only scope there is, so it has to name the table it is
   * actually filtering.
   */
  private scopeOf(column: PgColumn): SQL {
    return eq(column, this.context.projectId);
  }

  /** The three derived fields, for a whole page at once rather than per row. */
  private async decorate(
    rows: readonly (typeof users.$inferSelect)[],
  ): Promise<readonly ProjectUserRow[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const now = new Date();

    const [providerRows, passkeyRows, factorRows, sessionRows] = await Promise.all([
      this.tx
        .select({ userId: identities.userId, provider: identities.provider })
        .from(identities)
        .where(and(this.scopeOf(identities.projectId), inArray(identities.userId, ids))),
      this.tx
        .select({ userId: webauthnCredentials.userId })
        .from(webauthnCredentials)
        .where(
          and(
            this.scopeOf(webauthnCredentials.projectId),
            inArray(webauthnCredentials.userId, ids),
          ),
        ),
      this.tx
        .select({ userId: mfaFactors.userId, type: mfaFactors.type })
        .from(mfaFactors)
        .where(
          and(
            this.scopeOf(mfaFactors.projectId),
            inArray(mfaFactors.userId, ids),
            // Enrolment is two calls and only the second proves the secret reached the
            // authenticator, so an unverified row is a factor nobody can answer with.
            isNotNull(mfaFactors.verifiedAt),
          ),
        ),
      this.tx
        .select({ userId: sessions.userId, total: count() })
        .from(sessions)
        .where(
          and(
            this.scopeOf(sessions.projectId),
            inArray(sessions.userId, ids),
            isNull(sessions.revokedAt),
            gt(sessions.absoluteExpiresAt, now),
          ),
        )
        .groupBy(sessions.userId),
    ]);

    const providers = groupBy(providerRows, (row) => row.userId);
    const passkeys = new Set(passkeyRows.map((row) => row.userId));
    // A passkey is a way in as well as a factor, so it does not on its own mean MFA is on;
    // `demandsChallenge` is what separates the two, and only an authenticator sets it.
    const mfa = new Set(factorRows.filter((row) => row.type !== "passkey").map((r) => r.userId));
    const live = new Map(sessionRows.map((row) => [row.userId, Number(row.total)]));

    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      email: row.email,
      emailVerified: row.emailVerified,
      phone: row.phone,
      phoneVerified: row.phoneVerified,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      methods: methodsFor(row, providers.get(row.id) ?? [], passkeys.has(row.id)),
      mfaEnabled: mfa.has(row.id),
      activeSessions: live.get(row.id) ?? 0,
      bannedUntil: row.bannedUntil,
      lastSignInAt: row.lastSignInAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      metadataPublic: (row.metadataPublic ?? {}) as Readonly<Record<string, unknown>>,
    }));
  }
}

/**
 * What this account can sign in with.
 *
 * Read off what exists rather than off a column, because a column would be a second copy
 * of the truth and would be wrong the first time somebody unlinked a provider. An account
 * with no address, no number and no identities has only ever been anonymous.
 */
function methodsFor(
  row: typeof users.$inferSelect,
  providers: readonly { readonly provider: string }[],
  hasPasskey: boolean,
): readonly SignInMethod[] {
  const methods = new Set<SignInMethod>();
  if (row.passwordHash !== null) methods.add("password");
  if (row.email !== null) {
    methods.add("email_otp");
    methods.add("magic_link");
  }
  if (row.phone !== null) methods.add("sms_otp");
  if (hasPasskey) methods.add("passkey");
  for (const identity of providers) methods.add(identity.provider);
  if (methods.size === 0) methods.add("anonymous");
  return [...methods].sort();
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket === undefined) grouped.set(key(row), [row]);
    else bucket.push(row);
  }
  return grouped;
}

/**
 * `%` and `_` are wildcards in LIKE, so a search for `a_b@example.test` would otherwise
 * match `axb@example.test`. Escaped rather than stripped, because the characters are legal
 * in an address and a support person pasting one has to find the account it names.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

/**
 * A cursor we cannot read is treated as absent rather than as an error.
 *
 * It is our own opaque value and a malformed one means a truncated URL or a stale
 * bookmark, so the useful answer is the first page. Throwing would turn a copied link into
 * a broken screen.
 */
function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (cursor === undefined || cursor.length === 0) return null;
  try {
    const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (at === undefined || id === undefined) return null;
    const createdAt = new Date(at);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
