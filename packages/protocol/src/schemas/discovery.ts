import { z } from "zod";

/**
 * OIDC discovery document. We are a standards-compliant provider, so any
 * off-the-shelf library can verify our tokens (PROJECT.md 4.2).
 */
export const openidConfigurationSchema = z.object({
  issuer: z.url(),
  jwks_uri: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  userinfo_endpoint: z.url(),
  response_types_supported: z.array(z.string()),
  subject_types_supported: z.array(z.string()),
  id_token_signing_alg_values_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()),
  grant_types_supported: z.array(z.string()),
});

/** Public half of a per-project signing key. Two are published during rotation overlap. */
export const jwkSchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string(),
  y: z.string(),
  kid: z.string(),
  alg: z.literal("ES256"),
  use: z.literal("sig"),
});

export const jwksSchema = z.object({ keys: z.array(jwkSchema) });

export type OpenidConfiguration = z.infer<typeof openidConfigurationSchema>;
export type Jwk = z.infer<typeof jwkSchema>;
export type Jwks = z.infer<typeof jwksSchema>;
