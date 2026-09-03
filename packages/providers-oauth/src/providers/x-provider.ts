import { OauthProviderError } from "@idenzy/core/errors";
import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import {
  type OAuthCallback,
  type OAuthFlowStore,
  OAuthProvider,
  type ProviderCredentials,
  type ProviderProfile,
  type RedirectAllowlist,
  type StoredFlow,
  type TokenGrant,
} from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";

interface XUser {
  readonly id?: string;
  readonly name?: string | null;
  readonly username?: string | null;
  readonly profile_image_url?: string | null;
}

/**
 * X (PROJECT.md 4.6).
 *
 * Two things make this the odd one. The token endpoint takes HTTP Basic client
 * authentication rather than credentials in the body, and RFC 6749 forbids presenting both,
 * so the secret moves to the header and out of the form.
 *
 * And there is no address. X releases one only to applications with elevated access, so a
 * user who arrives this way has no email at all: the account is created on the provider
 * subject alone, nothing can be linked on an address, and a customer's UI collects one
 * afterwards if their product needs it.
 */
export class XProvider extends OAuthProvider {
  override readonly id = ProviderId.X;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://x.com/i/oauth2/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://api.x.com/2/oauth2/token";
  }

  /**
   * `offline.access` is not requested. We hold provider tokens only where a project turned
   * storage on, and a refresh token nobody asked to keep is a credential with no purpose.
   */
  protected override defaultScopes(): readonly string[] {
    return ["tweet.read", "users.read"];
  }

  protected override tokenHeaders(credentials: ProviderCredentials): Record<string, string> {
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString(
      "base64",
    );
    return { authorization: `Basic ${basic}` };
  }

  /** The secret rides in the header instead. Presenting it twice is refused by the spec. */
  protected override tokenRequest(
    credentials: ProviderCredentials,
    callback: OAuthCallback,
    flow: StoredFlow,
  ): Promise<Record<string, string>> {
    return Promise.resolve({
      grant_type: "authorization_code",
      code: callback.code,
      redirect_uri: callback.callbackUri,
      client_id: credentials.clientId,
      code_verifier: flow.codeVerifier,
    });
  }

  protected override async fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const url = new URL("https://api.x.com/2/users/me");
    url.searchParams.set("user.fields", "profile_image_url");

    const response = await this.http.json<{ readonly data?: XUser }>({
      url: url.toString(),
      method: "GET",
      headers: { authorization: `Bearer ${grant.accessToken}` },
    });

    const user = response.data.data;
    const id = user?.id;
    if (response.status >= 400 || user === undefined || typeof id !== "string") {
      throw new OauthProviderError({
        detail: { provider: this.id, statusCode: response.status },
      });
    }

    return {
      // The numeric id as a string, never the handle: handles are renamed and released, and
      // an account keyed on one could be taken over by whoever claims it next.
      providerUserId: id,
      email: null,
      emailVerified: false,
      displayName: user.name ?? user.username ?? null,
      avatarUrl: user.profile_image_url ?? null,
    };
  }
}
