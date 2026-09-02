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
  @Get("openid-configuration")
  @NoTenant()
  @Header("cache-control", "public, max-age=3600")
  configuration(): OpenidConfiguration {
    const issuer = "https://auth.example.test";
    return {
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["ES256"],
      // S256 only. `plain` is in the spec and is not a PKCE implementation worth having.
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
    };
  }

  @Get("jwks.json")
  @NoTenant()
  @Header("cache-control", "public, max-age=600")
  jwks(): Jwks {
    return { keys: [] };
  }
}
