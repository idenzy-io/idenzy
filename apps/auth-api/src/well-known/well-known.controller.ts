import { AppConfig } from "@idenzy/config/app-config";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import type { Jwks, OpenidConfiguration } from "@idenzy/protocol/schemas/discovery";
import { Controller, Get, Header } from "@nestjs/common";
import { NoTenant } from "../tenancy/tenant-resolution.guard.js";

/**
 * OIDC discovery and JWKS (PROJECT.md 4.2).
 *
 * Being a standards-compliant provider means any off-the-shelf library verifies our
 * tokens, which matters more for us than for a vendor that ships SDKs with UI: a
 * customer on a platform we have no SDK for can still integrate.
 *
 * Cached hard at the CDN and keyed by kid, so verification never costs us a request.
 */
@Controller(".well-known")
export class WellKnownController {
  constructor(
    private readonly config: AppConfig,
    private readonly tokens: TokenIssuer,
  ) {}

  /**
   * What we publish, and what we deliberately do not.
   *
   * Everything here is true of a token we sign, which is the only thing a reader of this
   * document can do something with. The authorization-server half is omitted: this
   * advertised `authorization_endpoint`, `token_endpoint` and `userinfo_endpoint` at
   * `/oauth/authorize`, `/oauth/token` and `/userinfo`, and none of the three is a route
   * on this service. A client following them was redirected into a 404 after we had
   * already sent a user somewhere, where the same client now fails at discovery instead.
   *
   * Our OAuth endpoints under `/v1/auth/oauth` are not these. They make us the *client*
   * of somebody else's provider, so publishing them here would invite a caller to treat
   * us as an authorization server we are not.
   */
  @Get("openid-configuration")
  @NoTenant()
  @Header("cache-control", "public, max-age=3600")
  configuration(): OpenidConfiguration {
    const issuer = this.config.get("ISSUER_BASE_URL");
    return {
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["ES256"],
    };
  }

  /**
   * Two keys appear here during a rotation overlap, which is why the response is a list
   * and why the cache window is short relative to the rotation period.
   */
  @Get("jwks.json")
  @NoTenant()
  @Header("cache-control", "public, max-age=600")
  async jwks(): Promise<Jwks> {
    return { keys: [...(await this.tokens.publicKeys())] };
  }
}
