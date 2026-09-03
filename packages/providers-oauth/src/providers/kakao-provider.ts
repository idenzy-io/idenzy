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

interface KakaoUser {
  readonly id?: number;
  readonly kakao_account?: {
    readonly email?: string | null;
    /** False when Kakao considers the address unusable, whatever its verification says. */
    readonly is_email_valid?: boolean;
    readonly is_email_verified?: boolean;
    readonly profile?: {
      readonly nickname?: string | null;
      readonly profile_image_url?: string | null;
    };
  };
}

/**
 * Kakao (PROJECT.md 4.6).
 *
 * Plain OAuth 2 against the REST API. Kakao can speak OIDC, but only for a channel that
 * turned it on in the console, and the REST flow is the one every existing Kakao
 * application is already configured for.
 *
 * The address is the reason to read this adapter. Kakao states verification, which makes
 * it a provider an account can be linked on, but it states it in two fields and both
 * matter: `is_email_verified` is what the user did, and `is_email_valid` is whether Kakao
 * still considers the address usable, which goes false when the address has been taken
 * over by another Kakao account. Reading only the first would link an account on an
 * address that now belongs to somebody else, so both must be true.
 *
 * Each of the three fields is behind consent the user can decline, so a profile with no
 * address at all is normal rather than an error.
 */
export class KakaoProvider extends OAuthProvider {
  override readonly id = ProviderId.Kakao;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://kauth.kakao.com/oauth/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://kauth.kakao.com/oauth/token";
  }

  protected override defaultScopes(): readonly string[] {
    return ["profile_nickname", "profile_image", "account_email"];
  }

  protected override async fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const response = await this.http.json<KakaoUser>({
      url: "https://kapi.kakao.com/v2/user/me",
      method: "GET",
      headers: { authorization: `Bearer ${grant.accessToken}` },
    });
    const user = response.data;
    if (response.status >= 400 || typeof user.id !== "number") {
      throw new OauthProviderError({
        detail: { provider: this.id, statusCode: response.status },
      });
    }

    const account = user.kakao_account;
    const email = account?.email ?? null;
    return {
      // Stringified, because the identity table stores a string and every other provider's
      // subject is one. The value is Kakao's own immutable member id.
      providerUserId: String(user.id),
      email,
      emailVerified:
        email !== null && account?.is_email_valid === true && account.is_email_verified === true,
      displayName: account?.profile?.nickname ?? null,
      avatarUrl: account?.profile?.profile_image_url ?? null,
    };
  }
}
