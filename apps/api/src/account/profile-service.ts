import { SessionRevokedError } from "@idenzy/core/errors";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * The signed-in user's own profile.
 *
 * This is what a client calls when it holds a token but no user, which for a browser SDK is
 * every page load that did not just sign in.
 *
 * Two decisions worth stating, because both look like omissions. A missing user answers
 * `session_revoked` rather than 404: the guard already proved the session, so a user that is
 * not there means the session should have died and saying "not found" would invite a retry.
 * And this deliberately does not call `assertCanSignIn` — `RefreshService` documents that a
 * ban takes effect at the next rotation, which bounds a suspended account to one access-token
 * lifetime, and re-checking here would make the two endpoints disagree about when that is.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly uow: UnitOfWork) {}

  async me(context: FlowContext, userId: string): Promise<PublicUser> {
    const tenant = tenantContextFrom(context);
    const user = await this.uow.transaction((tx) =>
      new UserRepository(tx, tenant).findById(userId),
    );
    if (user === null) throw new SessionRevokedError({ detail: { userId } });
    return user.toPublic();
  }
}
