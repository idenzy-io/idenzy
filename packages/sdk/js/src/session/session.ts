import type { SessionCreated, SessionRefreshed } from "@idenzy/protocol/schemas/session";
import type { PublicUser } from "@idenzy/protocol/schemas/user";

/**
 * The session as the application sees it (PROJECT.md 7.2.9).
 *
 * It carries the access token and deliberately not the refresh token. The refresh token is
 * the long-lived credential and this object is the one handed to customer code, put in a
 * store, and printed in a console during debugging; keeping the two apart means none of that
 * can leak the thing that would let an attacker mint tokens for a year.
 */
export class Session {
  private constructor(
    readonly id: string,
    readonly user: PublicUser,
    readonly accessToken: string,
    readonly accessTokenExpiresAt: Date,
  ) {}

  static fromCreated(created: SessionCreated): Session {
    return new Session(
      created.sessionId,
      created.user,
      created.accessToken,
      new Date(created.accessTokenExpiresAt),
    );
  }

  /** A rotation returns the profile only when asked, so the caller supplies the current one. */
  static fromRefreshed(refreshed: SessionRefreshed, user: PublicUser): Session {
    return new Session(
      refreshed.sessionId,
      refreshed.user ?? user,
      refreshed.accessToken,
      new Date(refreshed.accessTokenExpiresAt),
    );
  }

  /**
   * True when the token is gone or close enough to it to be worth renewing.
   *
   * The margin covers two things at once: a client clock that runs fast, and the flight time
   * of the request the token is about to be attached to. A token that passes this check and
   * expires in transit produces a 401 the customer cannot do anything about.
   */
  expiresWithin(marginMs: number, nowMs: number): boolean {
    return this.accessTokenExpiresAt.getTime() - nowMs <= marginMs;
  }

  withUser(user: PublicUser): Session {
    return new Session(this.id, user, this.accessToken, this.accessTokenExpiresAt);
  }
}
