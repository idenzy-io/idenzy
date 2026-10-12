import { ResourceConflictError } from "@idenzy/core/errors";
import { WebauthnCredentialRepository } from "@idenzy/persistence/repository/webauthn-credential-repository";
import { WebauthnRelyingPartyRepository } from "@idenzy/persistence/repository/webauthn-relying-party-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { RelyingPartyAnswer, SaveRelyingParty } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/**
 * A project's passkey relying party (PROJECT.md 4.7), which nothing could set before this: the
 * panel's dialogs existed and their store refused.
 *
 * A credential is bound to the RP ID it was created under, so moving the project to another
 * domain leaves every passkey its users hold unable to sign in, with nothing on their side to
 * show why. A project with none moves freely. One with some moves only when the request names
 * how many it strands and the number is the one in the database, which is the panel's
 * acknowledgement checkbox made into something the server can check: a stale count, or none,
 * is refused with the real one. The credentials are kept, so moving back revives them. The name
 * and the origins change whenever.
 */
@Injectable()
export class RelyingPartyService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
  ) {}

  async find(context: OrgContext, projectId: string): Promise<RelyingPartyAnswer> {
    const tenant = await this.scope.of(context, projectId);
    return await this.uow.transaction(async (tx) => {
      const row = await new WebauthnRelyingPartyRepository(tx, tenant).find();
      return {
        relyingParty:
          row === null ? null : { rpId: row.rpId, rpName: row.rpName, origins: [...row.origins] },
        passkeys: await new WebauthnCredentialRepository(tx, tenant).count(),
      };
    });
  }

  async save(
    context: OrgContext,
    projectId: string,
    input: SaveRelyingParty,
  ): Promise<RelyingPartyAnswer> {
    const { strandPasskeys, ...party } = input;
    const tenant = await this.scope.of(context, projectId);
    return await this.uow.transaction(async (tx) => {
      const parties = new WebauthnRelyingPartyRepository(tx, tenant);
      const existing = await parties.find();
      const passkeys = await new WebauthnCredentialRepository(tx, tenant).count();
      if (existing !== null && existing.rpId !== party.rpId && passkeys > 0) {
        if (strandPasskeys !== passkeys) {
          throw new ResourceConflictError({
            message: `${passkeys} passkeys belong to ${existing.rpId} and stop signing in on a new domain. Send strandPasskeys: ${passkeys} to move anyway.`,
            detail: { entity: "webauthn_relying_party", rpId: existing.rpId, passkeys },
          });
        }
      }
      await parties.upsert(party);
      return { relyingParty: party, passkeys };
    });
  }
}
