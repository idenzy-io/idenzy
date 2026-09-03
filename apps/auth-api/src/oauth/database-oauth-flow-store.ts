import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import type { NewFlow, OAuthFlowStore, StoredFlow } from "@idenzy/domain/ports/oauth-provider";
import { OAuthFlowRepository } from "@idenzy/persistence/repository/oauth-flow-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Injectable } from "@nestjs/common";

/**
 * The flow store the OAuth base class consumes state from (PROJECT.md 4.6).
 *
 * The PKCE verifier is encrypted on the way in and decrypted on the way out, because we
 * are the OAuth client and have to present it at the token endpoint. It is the one
 * single-use secret in this system that cannot be a digest, which is why it gets
 * envelope encryption instead (PROJECT.md 4.13.4).
 */
@Injectable()
export class DatabaseOAuthFlowStore implements OAuthFlowStore {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly encryptor: FieldEncryptor,
  ) {}

  start(projectId: string, flow: NewFlow): Promise<string> {
    const tenant = tenantFor(projectId);
    return this.uow.run(tenant, (tx) =>
      new OAuthFlowRepository(tx, tenant).start({
        provider: flow.provider,
        state: flow.state,
        codeVerifierEncrypted: this.encryptor.encrypt(flow.codeVerifier, projectId),
        nonce: flow.nonce,
        redirectUri: flow.redirectUri,
        linkUserId: flow.linkUserId,
        expiresAt: flow.expiresAt,
        // Stored as given. It is a digest of the client's secret, not the secret.
        clientCodeChallenge: flow.clientCodeChallenge,
      }),
    );
  }

  async consume(
    projectId: string,
    provider: string,
    state: string,
    at: Date,
  ): Promise<StoredFlow | null> {
    const tenant = tenantFor(projectId);
    const row = await this.uow.run(tenant, (tx) =>
      new OAuthFlowRepository(tx, tenant).consume(provider, state, at),
    );
    if (row === null) return null;
    return {
      id: row.id,
      provider: row.provider,
      codeVerifier: this.encryptor.decrypt(row.codeVerifierEncrypted, projectId),
      nonce: row.nonce,
      redirectUri: row.redirectUri,
      linkUserId: row.linkUserId,
      expiresAt: row.expiresAt,
      clientCodeChallenge: row.clientCodeChallenge,
    };
  }
}

function tenantFor(projectId: string): TenantContext {
  return new TenantContext(projectId, "oauth", "user");
}
