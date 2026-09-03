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

interface ZoomUser {
  readonly id?: string;
  readonly email?: string | null;
  readonly display_name?: string | null;
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly pic_url?: string | null;
  /** 1 when Zoom confirmed the address, 0 when it did not. Not a boolean. */
  readonly verified?: number;
}

/**
 * Zoom (PROJECT.md 4.6).
 *
 * Plain OAuth 2 with basic client authentication. Zoom does say whether it confirmed the
 * address, which makes this a provider an existing account can be linked on, but it says
 * so as a number rather than a boolean: `verified` is 1 or 0, and a truthiness check would
 * read the string "0" as confirmed. It is compared against 1 for that reason, and anything
 * else at all reads as unconfirmed.
 */
export class ZoomProvider extends OAuthProvider {
  override readonly id = ProviderId.Zoom;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://zoom.us/oauth/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://zoom.us/oauth/token";
  }

  protected override clientAuthentication(): "basic" {
    return "basic";
  }

  protected override defaultScopes(): readonly string[] {
    return ["user:read:user"];
  }

  protected override async fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const response = await this.http.json<ZoomUser>({
      url: "https://api.zoom.us/v2/users/me",
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

    const name = [user.first_name, user.last_name]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" ");
    return {
      // Zoom's own user id, which survives the address changing and an account moving
      // between Zoom accounts.
      providerUserId: id,
      email: user.email ?? null,
      emailVerified: user.verified === 1 && typeof user.email === "string",
      displayName: user.display_name ?? (name.length > 0 ? name : null),
      avatarUrl: user.pic_url ?? null,
    };
  }
}
