import { ResourceNotFoundError, ValidationFailedError } from "@idenzy/core/errors";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import type { OAuthProvider, ProviderCredentials } from "@idenzy/domain/ports/oauth-provider";
import { OAuthProviderRepository } from "@idenzy/persistence/repository/oauth-provider-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { OauthMode } from "@idenzy/protocol/enums/providers";
import { Inject, Injectable } from "@nestjs/common";
import { OAUTH_PROVIDERS } from "./oauth-tokens.js";

/** Hosts our shared OAuth apps may return to. Anything else must use its own app. */
const INSTANT_MODE_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.idenzy\.dev)$/i;

/**
 * The providers this deployment implements, and the credentials each project gave them
 * (PROJECT.md 4.6).
 *
 * Provider instances are built once and shared. They hold no per-request state: the
 * credentials arrive as an argument on every call precisely so that one instance can
 * serve every tenant without ever holding one tenant's secret between requests.
 *
 * The map is injected rather than built here, so which providers exist is a decision in
 * the composition root and a test can register one that does not need the network.
 */
@Injectable()
export class ProviderRegistry {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly encryptor: FieldEncryptor,
    @Inject(OAUTH_PROVIDERS) private readonly providers: ReadonlyMap<string, OAuthProvider>,
  ) {}

  /** Rejects an unknown provider at the boundary, before any lookup touches the database. */
  provider(name: string): OAuthProvider {
    const found = this.providers.get(name);
    if (found === undefined) {
      throw new ValidationFailedError({
        message: "That provider is not available.",
        fields: [{ path: "provider", code: "unsupported" }],
      });
    }
    return found;
  }

  /**
   * A project's configuration for one provider, in a single read.
   *
   * The secret is decrypted here and nowhere earlier, so it exists in memory only for
   * the call that needs it. A provider the project has not enabled answers exactly like
   * one that was never configured, so a probe cannot map which providers a customer is
   * part-way through setting up.
   */
  async configure(
    projectId: string,
    provider: string,
  ): Promise<{ credentials: ProviderCredentials; mode: string }> {
    const tenant = new TenantContext(projectId, "oauth", "user");
    const row = await this.uow.run(tenant, (tx) =>
      new OAuthProviderRepository(tx, tenant).find(provider),
    );
    if (row === null || !row.enabled || row.clientId === null) {
      throw new ResourceNotFoundError({ detail: { entity: "oauth_provider", provider } });
    }
    return {
      credentials: {
        clientId: row.clientId,
        clientSecret:
          row.clientSecretEncrypted === null
            ? ""
            : this.encryptor.decrypt(row.clientSecretEncrypted, projectId),
        scopes: row.scopes,
        config: row.settings,
      },
      mode: row.mode ?? OauthMode.Custom,
    };
  }

  /**
   * Instant mode uses our shared OAuth app, which shows our brand on the consent screen
   * and whose client id is the same for every customer. That is fine while someone is
   * trying the product on their laptop and is not fine in front of real users, so it is
   * restricted to localhost and preview hosts (PROJECT.md 4.6).
   */
  static assertInstantModeAllowed(mode: string, redirectUri: string): void {
    if (mode !== OauthMode.Instant) return;
    const host = URL.parse(redirectUri)?.hostname ?? "";
    if (!INSTANT_MODE_HOSTS.test(host)) {
      throw new ValidationFailedError({
        message: "Instant mode works only on localhost and preview domains.",
        fields: [{ path: "redirectUri", code: "instant_mode_host" }],
      });
    }
  }
}
