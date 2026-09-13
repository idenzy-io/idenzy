import { createHash, createHmac } from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";
const TERMINATOR = "aws4_request";

/**
 * Credentials, fetched per request rather than held.
 *
 * A function and not a value because the credentials we intend to end up with expire.
 * PROJECT.md 4.11 says zero static credentials, and the way to honour that from Cloud Run
 * is federation — the service account's own OIDC token exchanged through
 * `AssumeRoleWithWebIdentity` for a set that lasts an hour. That is not built, and a long-
 * lived access key from Secret Manager is what the first deployment will use. Making the
 * shape async now means replacing one is a different provider function and not a change to
 * every caller.
 */
export type AwsCredentialsProvider = () => Promise<AwsCredentials>;

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Present only for temporary credentials, and signed as a header when it is. */
  readonly sessionToken?: string;
}

export interface SignedRequest {
  readonly method: string;
  readonly url: URL;
  readonly body: string;
  readonly region: string;
  readonly service: string;
  readonly headers: Readonly<Record<string, string>>;
}

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const hmac = (key: Buffer | string, value: string): Buffer =>
  createHmac("sha256", key).update(value, "utf8").digest();

/** `20260913T151200Z` and `20260913`, which are the only two forms SigV4 uses. */
function stamps(now: Date): { readonly amzDate: string; readonly dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * AWS Signature Version 4, over `node:crypto` and nothing else.
 *
 * Written here rather than taken from `@aws-sdk/*` for the reason in PROJECT.md 7.6, and
 * the same one `CloudTasksScheduler` was written for: the entire use of that SDK would be
 * one POST with a JSON body, and the client package brings a dependency tree wider than
 * the feature into a service whose supply chain is a stated threat (4.1, threat 10).
 *
 * Two details here are the ones a hand-rolled signer gets wrong. The signed header list
 * must be sorted and lowercased *and* must name exactly the headers that are sent — a
 * header present in the request but absent from `SignedHeaders` is a signature that
 * verifies against a message nobody sent. And `host` must be signed: without it a valid
 * signature can be replayed against a different endpoint in the same region.
 */
export function signRequest(
  request: SignedRequest,
  credentials: AwsCredentials,
  now: Date,
): Readonly<Record<string, string>> {
  const { amzDate, dateStamp } = stamps(now);

  const headers: Record<string, string> = {
    ...request.headers,
    host: request.url.host,
    "x-amz-date": amzDate,
    ...(credentials.sessionToken === undefined
      ? {}
      : { "x-amz-security-token": credentials.sessionToken }),
  };

  const canonicalHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowered = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );

  const canonicalHeaders = canonicalHeaderNames
    .map((name) => `${name}:${(lowered.get(name) ?? "").trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = canonicalHeaderNames.join(";");

  // The query string is sorted by key, and empty is the common case here.
  const query = [...request.url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  const payloadHash = sha256Hex(request.body);

  const canonicalRequest = [
    request.method,
    request.url.pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${request.region}/${request.service}/${TERMINATOR}`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(
    hmac(
      hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), request.region),
      request.service,
    ),
    TERMINATOR,
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
