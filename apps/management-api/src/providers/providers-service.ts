import { ResourceNotFoundError } from "@idenzy/core/errors";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import {
  OAuthProviderRepository,
  type ProviderConfigRow,
} from "@idenzy/persistence/repository/oauth-provider-repository";
import { RedirectUriRepository } from "@idenzy/persistence/repository/redirect-uri-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type {
  OauthProviderConfig,
  ProviderMode,
  SaveOauthProvider,
} from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/** The redirect kind these URIs are filed under, matching what the auth API checks. */
const OAUTH_RETURN = "oauth";

/**
 * A project's social providers and the URIs a completed flow may return to
 * (PROJECT.md 4.6).
 *
 * The client secret is the reason this service exists rather than the settings document
 * handling it. It is `encrypted()` under the project's own data key, so writing one needs a
 * `FieldEncryptor` and reading one back is something this API deliberately cannot do: the
 * panel is told a secret is stored and when, never what it is.
 *
 * Which is why a save takes the secret as three states rather than two. Absent leaves the
 * stored one alone, a string replaces it, null clears it — and absent has to mean "leave
 * it" because the panel has nothing to send back. Treating absent as "clear" would blank a
 * customer's credential every time somebody flipped the enabled switch, and they would find
 * out at their users' next sign-in.
 */
@Injectable()
export class ProvidersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
    private readonly encryptor: FieldEncryptor,
  ) {}

  async list(context: OrgContext, projectId: string): Promise<readonly OauthProviderConfig[]> {
    const tenant = await this.scope.of(context, projectId);
    const rows = await this.uow.run(tenant, (tx) => new OAuthProviderRepository(tx, tenant).list());
    return rows.map(present);
  }

  async save(
    context: OrgContext,
    projectId: string,
    provider: string,
    input: SaveOauthProvider,
  ): Promise<OauthProviderConfig> {
    const tenant = await this.scope.of(context, projectId);

    const encrypted =
      input.clientSecret === undefined
        ? undefined
        : input.clientSecret === null
          ? null
          : // Under the project's own data key, with the project id as additional
            // authenticated data — so a ciphertext lifted into another project's row
            // fails to decrypt rather than quietly working.
            await this.encryptor.encrypt(input.clientSecret, tenant.projectId);

    const saved = await this.uow.run(tenant, async (tx) => {
      const repository = new OAuthProviderRepository(tx, tenant);
      await repository.upsert({
        provider,
        clientId: input.clientId,
        ...(encrypted === undefined ? {} : { clientSecretEncrypted: encrypted }),
        scopes: input.scopes,
        settings: { ...input.settings, storeTokens: input.storeTokens },
        enabled: input.enabled,
        mode: input.mode,
      });
      return await repository.find(provider);
    });

    if (saved === null) {
      throw new ResourceNotFoundError({ detail: { provider } });
    }
    return present(saved);
  }

  async remove(context: OrgContext, projectId: string, provider: string): Promise<void> {
    const tenant = await this.scope.of(context, projectId);
    const removed = await this.uow.run(tenant, (tx) =>
      new OAuthProviderRepository(tx, tenant).remove(provider),
    );
    if (!removed) throw new ResourceNotFoundError({ detail: { provider } });
  }

  async returnUris(context: OrgContext, projectId: string): Promise<readonly string[]> {
    const tenant = await this.scope.of(context, projectId);
    return await this.uow.run(tenant, (tx) =>
      new RedirectUriRepository(tx, tenant).list(OAUTH_RETURN),
    );
  }

  /** Registering the same URI twice is not an error; the unique index makes it a no-op. */
  async addReturnUri(context: OrgContext, projectId: string, uri: string): Promise<void> {
    const tenant = await this.scope.of(context, projectId);
    await this.uow.run(tenant, (tx) =>
      new RedirectUriRepository(tx, tenant).register(OAUTH_RETURN, uri),
    );
  }

  async removeReturnUri(context: OrgContext, projectId: string, uri: string): Promise<void> {
    const tenant = await this.scope.of(context, projectId);
    const removed = await this.uow.run(tenant, (tx) =>
      new RedirectUriRepository(tx, tenant).remove(OAUTH_RETURN, uri),
    );
    if (!removed) throw new ResourceNotFoundError({ detail: { uri } });
  }
}

/**
 * The row as the wire sees it, with the secret reduced to whether there is one.
 *
 * `storeTokens` lives inside the provider's `settings` blob because that is where the auth
 * API's flow already reads it from, and moving it would be a migration for a boolean. It is
 * lifted out here so the panel has a field rather than a bag to rummage in.
 */
function present(row: ProviderConfigRow): OauthProviderConfig {
  const { storeTokens, ...rest } = row.settings;
  return {
    provider: row.provider,
    enabled: row.enabled,
    mode: row.mode as ProviderMode,
    clientId: row.clientId,
    secretSet: row.clientSecretEncrypted !== null,
    scopes: [...row.scopes],
    settings: Object.fromEntries(
      Object.entries(rest).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    storeTokens: storeTokens === true,
  };
}
