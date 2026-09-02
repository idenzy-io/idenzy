import { ResourceNotFoundError } from "@idenzy/core/errors/errors";
import { User } from "@idenzy/domain/entities/user";
import { and, eq } from "drizzle-orm";
import { users } from "../schema/identity.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";

type UserRow = typeof users.$inferSelect;

export interface NewUser {
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly phone: string | null;
  readonly passwordHash: string | null;
  readonly passwordAlgoVersion: number | null;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly metadataPublic?: Readonly<Record<string, unknown>>;
}

/**
 * Reads and writes users within one tenant transaction.
 *
 * Every method starts from `tenantScope()`, and the RLS policy on the table is the
 * second, independent line if one ever does not (ADR-0003). Lookups return the `User`
 * entity rather than a row, so the sign-in rules live in one place and this class stays
 * about SQL.
 */
export class UserRepository extends BaseRepository<typeof users> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, users);
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.tx
      .select()
      .from(users)
      .where(and(this.tenantScope(), eq(users.id, id)))
      .limit(1);
    return this.toEntity(rows[0]);
  }

  /**
   * Case is already folded by `emailSchema` at the boundary, so this is an exact match
   * on the same value the unique index enforces.
   */
  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.tx
      .select()
      .from(users)
      .where(and(this.tenantScope(), eq(users.email, email)))
      .limit(1);
    return this.toEntity(rows[0]);
  }

  async create(input: NewUser): Promise<User> {
    const rows = await this.guard(() =>
      this.tx
        .insert(users)
        .values({
          projectId: this.context.projectId,
          email: input.email,
          emailVerified: input.emailVerified,
          phone: input.phone,
          passwordHash: input.passwordHash,
          passwordAlgoVersion: input.passwordAlgoVersion,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          metadataPublic: input.metadataPublic ?? {},
        })
        .returning(),
    );
    return this.required(rows[0]);
  }

  /** Used both by reset and by a transparent rehash after a successful sign-in. */
  async setPassword(userId: string, hash: string, algorithmVersion: number): Promise<void> {
    await this.tx
      .update(users)
      .set({ passwordHash: hash, passwordAlgoVersion: algorithmVersion, updatedAt: new Date() })
      .where(and(this.tenantScope(), eq(users.id, userId)));
  }

  async setEmail(userId: string, email: string, verified: boolean): Promise<User> {
    const rows = await this.guard(() =>
      this.tx
        .update(users)
        .set({ email, emailVerified: verified, updatedAt: new Date() })
        .where(and(this.tenantScope(), eq(users.id, userId)))
        .returning(),
    );
    return this.required(rows[0]);
  }

  async setEmailVerified(userId: string, verified: boolean): Promise<void> {
    await this.tx
      .update(users)
      .set({ emailVerified: verified, updatedAt: new Date() })
      .where(and(this.tenantScope(), eq(users.id, userId)));
  }

  /**
   * Turns an anonymous account into a real one in place, so everything the customer
   * already attached to the user id survives the upgrade (PROJECT.md 3.1).
   */
  async attachCredentials(
    userId: string,
    email: string,
    hash: string,
    algorithmVersion: number,
  ): Promise<User> {
    const rows = await this.guard(() =>
      this.tx
        .update(users)
        .set({
          email,
          emailVerified: false,
          passwordHash: hash,
          passwordAlgoVersion: algorithmVersion,
          updatedAt: new Date(),
        })
        .where(and(this.tenantScope(), eq(users.id, userId)))
        .returning(),
    );
    return this.required(rows[0]);
  }

  async recordSignIn(userId: string, at: Date): Promise<void> {
    await this.tx
      .update(users)
      .set({ lastSignInAt: at })
      .where(and(this.tenantScope(), eq(users.id, userId)));
  }

  private toEntity(row: UserRow | undefined): User | null {
    if (row === undefined) return null;
    return new User({
      id: row.id,
      projectId: row.projectId,
      email: row.email,
      emailVerified: row.emailVerified,
      phone: row.phone,
      phoneVerified: row.phoneVerified,
      passwordHash: row.passwordHash,
      passwordAlgoVersion: row.passwordAlgoVersion,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      metadataPublic: asRecord(row.metadataPublic),
      bannedUntil: row.bannedUntil,
      lastSignInAt: row.lastSignInAt,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    });
  }

  /** For writes, where a missing row means the tenant scope excluded it. */
  private required(row: UserRow | undefined): User {
    const entity = this.toEntity(row);
    if (entity === null) throw new ResourceNotFoundError({ detail: { entity: "user" } });
    return entity;
  }
}
