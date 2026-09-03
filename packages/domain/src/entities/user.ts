import { AccountBannedError, InvalidCredentialsError } from "@idenzy/core/errors";
import type { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { PublicUser } from "@idenzy/protocol/schemas/user";

export interface UserState {
  readonly id: string;
  readonly projectId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly phone: string | null;
  readonly phoneVerified: boolean;
  readonly passwordHash: string | null;
  readonly passwordAlgoVersion: number | null;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly metadataPublic: Readonly<Record<string, unknown>>;
  readonly bannedUntil: Date | null;
  readonly lastSignInAt: Date | null;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * An end user, and the rules about whether they may sign in (PROJECT.md 7.2.9).
 *
 * The four states that stop a sign-in are decided here rather than at each flow, so a
 * new flow cannot check three of them and believe it checked all four.
 */
export class User {
  constructor(private readonly state: UserState) {}

  get id(): string {
    return this.state.id;
  }

  get publicId(): string {
    return PublicId.encode(IdPrefix.User, this.state.id).value;
  }

  get email(): string | null {
    return this.state.email;
  }

  get emailVerified(): boolean {
    return this.state.emailVerified;
  }

  get phone(): string | null {
    return this.state.phone;
  }

  get phoneVerified(): boolean {
    return this.state.phoneVerified;
  }

  get passwordHash(): string | null {
    return this.state.passwordHash;
  }

  get passwordAlgoVersion(): number | null {
    return this.state.passwordAlgoVersion;
  }

  hasPassword(): boolean {
    return this.state.passwordHash !== null;
  }

  /**
   * No identifier and no credential, so nothing but the session proves who this is.
   * Upgrading such an account keeps the id and everything attached to it (PROJECT.md 3.1).
   */
  isAnonymous(): boolean {
    return (
      this.state.email === null && this.state.phone === null && this.state.passwordHash === null
    );
  }

  isDeleted(): boolean {
    return this.state.deletedAt !== null;
  }

  isBanned(clock: Clock): boolean {
    return this.state.bannedUntil !== null && !clock.hasPassed(this.state.bannedUntil);
  }

  /**
   * The gate every flow passes before a session can exist.
   *
   * A tombstoned user fails as invalid credentials, not as not-found: a distinguishable
   * answer would turn sign-in into a membership oracle for deleted accounts
   * (PROJECT.md 4.5). A ban is stated plainly, because the account holder has to be able
   * to find out why.
   */
  assertCanSignIn(clock: Clock): void {
    if (this.isDeleted()) {
      throw new InvalidCredentialsError({ detail: { userId: this.state.id, reason: "deleted" } });
    }
    if (this.isBanned(clock)) {
      throw new AccountBannedError({ detail: { userId: this.state.id } });
    }
  }

  /** The projection a client SDK receives. metadataPrivate is absent by construction. */
  toPublic(): PublicUser {
    return {
      id: this.publicId,
      email: this.state.email,
      emailVerified: this.state.emailVerified,
      phone: this.state.phone,
      phoneVerified: this.state.phoneVerified,
      displayName: this.state.displayName,
      avatarUrl: this.state.avatarUrl,
      metadataPublic: { ...this.state.metadataPublic },
      createdAt: this.state.createdAt.toISOString(),
      lastSignInAt: this.state.lastSignInAt?.toISOString() ?? null,
    };
  }
}
