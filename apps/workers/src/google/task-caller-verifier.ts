import { AccessTokenInvalidError } from "@idenzy/core/errors";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Who is allowed to ask this service to dispatch a delivery.
 *
 * A port, because the thing it stands in front of has two implementations that matter: Google's
 * signed OIDC token in a deployment with a queue, and whatever a test substitutes. It answers the
 * caller's identity rather than a boolean so a log line can say who it was.
 */
export abstract class TaskCallerVerifier {
  abstract verify(token: string): Promise<string>;
}

/** The two spellings Google has used for this issuer. Both are current in the wild. */
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

export interface GoogleOidcOptions {
  /** The key set, so a test can serve its own. Not settable from the environment. */
  readonly jwksUri?: string;
}

/**
 * Verifies the OIDC token Cloud Tasks attaches to a task, against Google's own keys.
 *
 * Cloud Run's IAM check is the first gate and this is the second, deliberately. `roles/run.invoker`
 * means an unauthenticated request never reaches the container — but it is a deployment setting, and
 * a service that is one `--allow-unauthenticated` away from a public endpoint that dispatches
 * deliveries should not rely on it alone. Verifying in process makes the property belong to the code.
 *
 * Three things are checked and all three matter. The signature, against Google's published keys, so
 * the token was minted by Google and not by whoever is calling. The audience, because a token issued
 * for some other service is a valid Google token and must not be accepted here. And the `email`,
 * because any Google identity can obtain a token for a public audience: the one that may drive this
 * endpoint is the service account Terraform made for it.
 */
export class GoogleOidcVerifier extends TaskCallerVerifier {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly expected: { readonly audience: string; readonly serviceAccount: string },
    options: GoogleOidcOptions = {},
  ) {
    super();
    this.keys = createRemoteJWKSet(new URL(options.jwksUri ?? JWKS_URI));
  }

  override async verify(token: string): Promise<string> {
    let email: unknown;
    let verified: unknown;
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: ISSUERS,
        audience: this.expected.audience,
        algorithms: ["RS256"],
      });
      // Bracketed because these are JWT claims rather than declared fields: `JWTPayload` carries an
      // index signature, and TS4111 is right that a dot here would read as a property that exists.
      email = payload["email"];
      verified = payload["email_verified"];
    } catch (error: unknown) {
      throw new AccessTokenInvalidError({
        detail: {
          component: "task-caller",
          reason: error instanceof Error ? error.message : "the token could not be verified",
        },
      });
    }

    if (email !== this.expected.serviceAccount || verified !== true) {
      throw new AccessTokenInvalidError({
        detail: { component: "task-caller", reason: "that identity may not dispatch deliveries" },
      });
    }
    return this.expected.serviceAccount;
  }
}
