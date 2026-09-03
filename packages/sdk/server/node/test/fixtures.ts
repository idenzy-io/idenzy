import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from "jose";

export const ISSUER = "https://auth.acme.test";
export const PROJECT = "prj_00000000000000000001";
export const OTHER_PROJECT = "prj_00000000000000000002";

export interface TestIssuer {
  readonly jwks: JSONWebKeySet;
  mint(claims?: MintOptions): Promise<string>;
}

export interface MintOptions {
  readonly issuer?: string;
  readonly audience?: string;
  readonly subject?: string;
  readonly sessionId?: string;
  readonly amr?: readonly string[];
  readonly fva?: number;
  readonly expiresInSeconds?: number;
  readonly extra?: Readonly<Record<string, unknown>>;
  /** The JOSE media type. Anything but `JWT` is a statement of another kind. */
  readonly typ?: string;
}

/**
 * A real ES256 signer, because the attacks worth testing here are all signature or claim
 * attacks and a stubbed verifier would accept every one of them.
 */
export async function testIssuer(kid = "test-key"): Promise<TestIssuer> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey);

  return {
    jwks: { keys: [{ ...jwk, kid, alg: "ES256", use: "sig" }] },
    mint(options: MintOptions = {}): Promise<string> {
      const now = Math.floor(Date.now() / 1000);
      const expiry = now + (options.expiresInSeconds ?? 300);
      return new SignJWT({
        sid: options.sessionId ?? "ses_00000000000000000001",
        amr: [...(options.amr ?? ["pwd"])],
        ...(options.fva === undefined ? {} : { fva: options.fva }),
        ...options.extra,
      })
        .setProtectedHeader({ alg: "ES256", kid, typ: options.typ ?? "JWT" })
        .setIssuer(options.issuer ?? ISSUER)
        .setAudience(options.audience ?? PROJECT)
        .setSubject(options.subject ?? "usr_00000000000000000001")
        .setIssuedAt(now)
        .setExpirationTime(expiry)
        .sign(privateKey);
    },
  };
}
