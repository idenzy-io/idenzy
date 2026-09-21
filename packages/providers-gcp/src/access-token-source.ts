import { InternalError } from "@idenzy/core/errors";
import { GoogleAuth } from "google-auth-library";

/**
 * An access token for calling a Google API as this service.
 *
 * A port rather than a call, for the usual two reasons: a test needs a seam that does not require
 * a credential of any kind, and the way a process proves who it is differs by where it runs.
 */
export abstract class AccessTokenSource {
  abstract token(): Promise<string>;
}

/** Everything under one scope; the service account's IAM roles are the real boundary. */
const CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";

export interface AdcTokenOptions {
  readonly scopes?: readonly string[];
  /** Injectable for tests. Nothing in application code passes this. */
  readonly auth?: GoogleAuth;
}

/**
 * A token from Application Default Credentials (PROJECT.md 4.11).
 *
 * ADC is the reason this is four lines rather than a JWT-bearer implementation. It resolves a
 * credential from the first place it finds one, and the order is exactly the deployment story:
 *
 *   1. `GOOGLE_APPLICATION_CREDENTIALS` — a service account key file, which is how the VPS runs.
 *   2. The metadata server — how a GCE VM or Cloud Run service runs, with no credential at all.
 *
 * **So the same code covers both and nothing has to be swapped on the way.** An earlier version of
 * this file hand-rolled the JWT-bearer exchange for the VPS case; it worked, and it would have
 * needed replacing the day anything moved onto Google. `google-auth-library` also owns the parts
 * that are easy to get subtly wrong — refresh before expiry, single-flight across concurrent
 * callers, retry on a failed exchange.
 *
 * It is the only Google dependency here. The full `@google-cloud/*` clients would each drag gax,
 * grpc-js and protobufjs onto the path that holds every credential we have, and §7.6 prefers one
 * audited library over three convenient ones — so KMS, Secret Manager and Storage are reached over
 * their REST APIs with `fetch`, the same way SES is reached with hand-written SigV4.
 *
 * Note what is *not* a secret here: `GOOGLE_APPLICATION_CREDENTIALS` holds a **path**, so it stays
 * an ordinary environment variable and does not belong in the secret store. The file it points at
 * is the credential, and that lives in the VPS's own secret handling.
 */
export class AdcTokenSource extends AccessTokenSource {
  private readonly auth: GoogleAuth;

  constructor(options: AdcTokenOptions = {}) {
    super();
    this.auth =
      options.auth ?? new GoogleAuth({ scopes: [...(options.scopes ?? [CLOUD_PLATFORM])] });
  }

  async token(): Promise<string> {
    const token = await this.auth.getAccessToken();
    if (token === null || token === undefined || token === "") {
      // ADC resolving to nothing means no credential was found anywhere it looked, which is a
      // deployment fault rather than a request one: on a VPS, GOOGLE_APPLICATION_CREDENTIALS is
      // unset or points at a file that is not there.
      throw new InternalError({
        detail: {
          reason: "Application Default Credentials resolved no token",
          remedy: "set GOOGLE_APPLICATION_CREDENTIALS to the service account key file",
          rule: "a process reaching Google must be able to say who it is (PROJECT.md 4.11)",
        },
      });
    }
    return token;
  }
}
