import { z } from "zod";

/**
 * OIDC discovery document (PROJECT.md 4.2).
 *
 * Deliberately the JWKS half of the spec and not the whole of it, because that is the
 * half we actually serve. A verifier reads `issuer`, `jwks_uri` and the signing algorithm
 * and needs nothing else, which is what makes "any off-the-shelf library verifies our
 * tokens" true.
 *
 * The authorization-server fields are absent rather than filled in. We ran with
 * `authorization_endpoint`, `token_endpoint` and `userinfo_endpoint` pointing at
 * `/oauth/authorize`, `/oauth/token` and `/userinfo`, none of which are routes: a client
 * that trusted the document got a 404 at the end of a redirect it had already sent a user
 * through. Omitting them fails that client at discovery instead, which is the same answer
 * arriving early enough to read. They are optional rather than deleted so the shape can
 * grow if we ever serve those endpoints — we are an authentication API, not an OAuth
 * authorization server, and today nothing here delegates authorization to a third party.
 */
export const openidConfigurationSchema = z.object({
  issuer: z.url(),
  jwks_uri: z.url(),
  subject_types_supported: z.array(z.string()),
  id_token_signing_alg_values_supported: z.array(z.string()),
  authorization_endpoint: z.url().optional(),
  token_endpoint: z.url().optional(),
  userinfo_endpoint: z.url().optional(),
  response_types_supported: z.array(z.string()).optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
  grant_types_supported: z.array(z.string()).optional(),
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
