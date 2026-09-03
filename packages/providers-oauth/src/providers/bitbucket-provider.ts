import { OauthProviderError } from "@idenzy/core/errors";
import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import {
  type OAuthFlowStore,
  OAuthProvider,
  type ProviderCredentials,
  type ProviderProfile,
  type RedirectAllowlist,
  type TokenGrant,
} from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";

const API = "https://api.bitbucket.org/2.0";

interface BitbucketUser {
  readonly uuid?: string;
  readonly display_name?: string | null;
  readonly nickname?: string | null;
  readonly links?: { readonly avatar?: { readonly href?: string | null } };
}

interface BitbucketEmail {
  readonly email?: string;
  readonly is_primary?: boolean;
  readonly is_confirmed?: boolean;
}

/**
 * Bitbucket Cloud (PROJECT.md 4.6).
 *
 * Plain OAuth 2, and shaped like GitHub: the user resource carries no address at all, so
 * the primary confirmed one is read from a second call. Bitbucket does say whether it
 * confirmed an address, which is what makes this a provider an existing account can be
 * linked on, and a user with no confirmed address signs in with none rather than with an
 * unconfirmed one.
 *
 * The second call is paginated like every other Bitbucket collection, so the addresses
 * arrive under `values` rather than as an array. A token without the `email` scope gets a
 * 403 there, which is a scope the project chose not to request rather than a failure.
 */
export class BitbucketProvider extends OAuthProvider {
  override readonly id = ProviderId.Bitbucket;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://bitbucket.org/site/oauth2/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://bitbucket.org/site/oauth2/access_token";
  }

  protected override clientAuthentication(): "basic" {
    return "basic";
  }

  protected override defaultScopes(): readonly string[] {
    return ["account", "email"];
  }

  protected override async fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const response = await this.http.json<BitbucketUser>({
      url: `${API}/user`,
      method: "GET",
      headers: { authorization: `Bearer ${grant.accessToken}` },
    });
    const user = response.data;
    const uuid = user.uuid;
    if (response.status >= 400 || typeof uuid !== "string") {
      throw new OauthProviderError({
        detail: { provider: this.id, statusCode: response.status },
      });
    }

    const primary = await this.primaryEmail(grant);
    return {
      // The braced uuid, never `nickname`: a Bitbucket nickname is renameable and the old
      // one is released, so an account keyed on one could be taken over.
      providerUserId: uuid,
      email: primary?.email ?? null,
      emailVerified: primary?.is_confirmed === true,
      displayName: user.display_name ?? user.nickname ?? null,
      avatarUrl: user.links?.avatar?.href ?? null,
    };
  }

  /** The primary confirmed address, or nothing. Unconfirmed is the same as absent here. */
  private async primaryEmail(grant: TokenGrant): Promise<BitbucketEmail | null> {
    const response = await this.http.json<{ readonly values?: readonly BitbucketEmail[] }>({
      url: `${API}/user/emails`,
      method: "GET",
      headers: { authorization: `Bearer ${grant.accessToken}` },
    });
    if (response.status >= 400 || !Array.isArray(response.data.values)) return null;
    return (
      response.data.values.find(
        (entry) => entry.is_primary === true && entry.is_confirmed === true,
      ) ?? null
    );
  }
}
