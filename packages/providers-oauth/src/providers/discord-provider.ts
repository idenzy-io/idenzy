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

interface DiscordUser {
  readonly id?: string;
  readonly username?: string;
  readonly global_name?: string | null;
  readonly email?: string | null;
  readonly verified?: boolean;
  readonly avatar?: string | null;
}

/**
 * Discord (PROJECT.md 4.6).
 *
 * Plain OAuth 2, and one of the few providers that says outright whether the address is
 * confirmed: `verified` on the user object is Discord's own flag, so this is one of the
 * providers a returning user can link an existing account with.
 *
 * The avatar is a hash rather than a URL, so it is assembled here. A null hash means the
 * user has never set one, and Discord's default avatar is a rendered image rather than a
 * file, so the honest answer is nothing at all.
 */
export class DiscordProvider extends OAuthProvider {
  override readonly id = ProviderId.Discord;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://discord.com/oauth2/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://discord.com/api/oauth2/token";
  }

  protected override defaultScopes(): readonly string[] {
    return ["identify", "email"];
  }

  protected override async fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const response = await this.http.json<DiscordUser>({
      url: "https://discord.com/api/users/@me",
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
      // The snowflake id, never the username: a username is changeable and reusable, so an
      // account keyed on one could be taken over by whoever claims it next.
      providerUserId: id,
      email: user.email ?? null,
      emailVerified: user.verified === true && typeof user.email === "string",
      displayName: user.global_name ?? user.username ?? null,
      avatarUrl:
        typeof user.avatar === "string"
          ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png`
          : null,
    };
  }
}
