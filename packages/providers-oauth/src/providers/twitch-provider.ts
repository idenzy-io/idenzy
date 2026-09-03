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

interface HelixUser {
  readonly id?: string;
  readonly login?: string;
  readonly display_name?: string | null;
  readonly email?: string | null;
  readonly profile_image_url?: string | null;
}

/**
 * Twitch (PROJECT.md 4.6).
 *
 * Plain OAuth 2. Twitch can issue an id_token, but only when `openid` is requested through
 * its own OIDC endpoints, and the access-token flow is the one every existing Twitch app is
 * already configured for.
 *
 * Two things differ from the other adapters. Helix wants the client id in a header as well as
 * the bearer token, so `fetchProfile` uses the credentials it is handed. And the answer is a
 * one-element array rather than an object, because the same endpoint looks up many users.
 *
 * The address is reported unverified: Twitch requires a confirmed address on an account and
 * says nothing about it in the payload, and that field decides whether a sign-in may take
 * over an existing account (PROJECT.md 4.6).
 */
export class TwitchProvider extends OAuthProvider {
  override readonly id = ProviderId.Twitch;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://id.twitch.tv/oauth2/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://id.twitch.tv/oauth2/token";
  }

  protected override defaultScopes(): readonly string[] {
    return ["user:read:email"];
  }

  protected override async fetchProfile(
    credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const response = await this.http.json<{ readonly data?: readonly HelixUser[] }>({
      url: "https://api.twitch.tv/helix/users",
      method: "GET",
      headers: {
        authorization: `Bearer ${grant.accessToken}`,
        "client-id": credentials.clientId,
      },
    });

    const user = response.data.data?.[0];
    const id = user?.id;
    if (response.status >= 400 || user === undefined || typeof id !== "string") {
      throw new OauthProviderError({
        detail: { provider: this.id, statusCode: response.status },
      });
    }

    return {
      // The numeric id as a string, never the login: a Twitch login can be changed and the
      // old one becomes available to somebody else.
      providerUserId: id,
      email: user.email ?? null,
      emailVerified: false,
      displayName: user.display_name ?? user.login ?? null,
      avatarUrl: user.profile_image_url ?? null,
    };
  }
}
