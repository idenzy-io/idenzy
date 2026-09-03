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

interface SpotifyUser {
  readonly id?: string;
  readonly display_name?: string | null;
  readonly email?: string | null;
  readonly images?: readonly { readonly url?: string | null }[];
}

/**
 * Spotify (PROJECT.md 4.6).
 *
 * Plain OAuth 2 with basic client authentication, and the address is the interesting part.
 * Spotify hands one over and says in its own reference that it is whatever the user typed
 * and that there is no proof it belongs to them. That is the rare case of a provider
 * stating the opposite of `email_verified`, so this reports false with something firmer
 * than the usual absence of an assertion behind it: nothing links on a Spotify address.
 */
export class SpotifyProvider extends OAuthProvider {
  override readonly id = ProviderId.Spotify;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://accounts.spotify.com/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://accounts.spotify.com/api/token";
  }

  protected override clientAuthentication(): "basic" {
    return "basic";
  }

  protected override defaultScopes(): readonly string[] {
    return ["user-read-email", "user-read-private"];
  }

  protected override async fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const response = await this.http.json<SpotifyUser>({
      url: "https://api.spotify.com/v1/me",
      method: "GET",
      headers: { authorization: `Bearer ${grant.accessToken}` },
    });
    const user = response.data;
    const id = user.id;
    if (response.status >= 400 || typeof id !== "string") {
      throw new OauthProviderError({
        detail: { provider: this.id, statusCode: response.status },
      });
    }

    return {
      // The Spotify user id, which is stable. `display_name` is not an identifier at all:
      // it is free text and two accounts may carry the same one.
      providerUserId: id,
      email: user.email ?? null,
      // Spotify says outright that this address is unverified.
      emailVerified: false,
      displayName: user.display_name ?? null,
      avatarUrl: user.images?.[0]?.url ?? null,
    };
  }
}
