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

/** Pinned, because Graph drops a version roughly every two years and an unpinned call breaks. */
const GRAPH = "https://graph.facebook.com/v21.0";

interface FacebookUser {
  readonly id?: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly picture?: { readonly data?: { readonly url?: string | null } };
}

/**
 * Facebook (PROJECT.md 4.6).
 *
 * Plain OAuth 2 rather than OIDC. Facebook can issue an id_token, but only for a client
 * configured for Facebook Login for Business, so the flow that works for every project is
 * the access token and a Graph call.
 *
 * The address is reported unverified and that is deliberate. Facebook confirms addresses in
 * practice and asserts nothing about it in the payload, and `emailVerified` is what decides
 * whether a sign-in may take over an existing account on the same address (PROJECT.md 4.6).
 * An assumption is not an assertion, so this one links nothing.
 */
export class FacebookProvider extends OAuthProvider {
  override readonly id = ProviderId.Facebook;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://www.facebook.com/v21.0/dialog/oauth";
  }

  protected override tokenEndpoint(): string {
    return `${GRAPH}/oauth/access_token`;
  }

  protected override defaultScopes(): readonly string[] {
    return ["public_profile", "email"];
  }

  protected override async fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    // Graph returns only the fields asked for, so the field list is the shape of the answer.
    const url = new URL(`${GRAPH}/me`);
    url.searchParams.set("fields", "id,name,email,picture.type(large)");

    const response = await this.http.json<FacebookUser>({
      url: url.toString(),
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
      // The app-scoped id: stable for this app and this user, and different in another app.
      // That is the only identifier Facebook gives, and it is the right one to store.
      providerUserId: id,
      email: user.email ?? null,
      emailVerified: false,
      displayName: user.name ?? null,
      avatarUrl: user.picture?.data?.url ?? null,
    };
  }
}
