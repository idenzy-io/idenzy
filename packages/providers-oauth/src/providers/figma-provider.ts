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

interface FigmaUser {
  readonly id?: string;
  readonly email?: string | null;
  readonly handle?: string | null;
  readonly img_url?: string | null;
}

/**
 * Figma (PROJECT.md 4.6).
 *
 * Plain OAuth 2 with basic client authentication. Figma confirms an address before an
 * account can be used and asserts nothing about it in the payload, so this reports
 * unverified: an assumption is not an assertion, and that field is what decides whether a
 * sign-in may take over an existing account (PROJECT.md 4.6).
 *
 * The scope is the narrow one. `current_user:read` is what `/v1/me` needs, and asking for
 * file access to sign somebody in is a consent screen that reads far worse than the
 * product warrants.
 */
export class FigmaProvider extends OAuthProvider {
  override readonly id = ProviderId.Figma;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://www.figma.com/oauth";
  }

  protected override tokenEndpoint(): string {
    return "https://api.figma.com/v1/oauth/token";
  }

  protected override clientAuthentication(): "basic" {
    return "basic";
  }

  protected override defaultScopes(): readonly string[] {
    return ["current_user:read"];
  }

  protected override async fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const response = await this.http.json<FigmaUser>({
      url: "https://api.figma.com/v1/me",
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
      // The user key, never the handle: a Figma handle is free text the user can change.
      providerUserId: id,
      email: user.email ?? null,
      emailVerified: false,
      displayName: user.handle ?? null,
      avatarUrl: user.img_url ?? null,
    };
  }
}
