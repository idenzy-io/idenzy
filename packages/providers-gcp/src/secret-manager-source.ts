import { SecretSource } from "@idenzy/config/secret-source";
import { InternalError } from "@idenzy/core/errors";
import { z } from "zod";
import { type AccessTokenSource, AdcTokenSource } from "./access-token-source.js";

const payloadSchema = z.object({
  payload: z.object({ data: z.string() }),
});

const API = "https://secretmanager.googleapis.com/v1";
const FETCH_TIMEOUT_MS = 5_000;

export interface SecretManagerOptions {
  /** The API base, so a test can stand in for it. Never settable from the environment. */
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  /**
   * Which version to read. `latest` unless a deployment is deliberately pinned.
   *
   * Pinning is the safer default in principle and the wrong one here: a secret is rotated by
   * adding a version, and a pinned deployment would keep using the rotated-away value until
   * somebody edited configuration — which is the failure that makes people stop rotating.
   */
  readonly version?: string;
}

/**
 * Secrets from Google Secret Manager, fetched once at boot and held in memory.
 *
 * What this replaces is credentials in `.env`. An environment file is copied to laptops, pasted
 * into chat, printed by `docker inspect` and committed by accident; none of that matters when what
 * it holds is `secret://stripe-secret-key` and the value lives here.
 *
 * **Read at startup and cached for the life of the process**, which is the shape asked for and is
 * also the right one: a per-request fetch would put an external dependency on every request path
 * and bill for it, and a secret changing under a running process is a restart rather than a
 * refresh. Rotation is therefore a deploy, which is the honest tradeoff of caching — and the
 * alternative, a TTL, means a window where half the fleet has the old value and half the new.
 */
export class SecretManagerSource extends SecretSource {
  private readonly cache = new Map<string, string>();

  /**
   * `tokens` defaults to Application Default Credentials, which is the whole deployment story in
   * one line: `GOOGLE_APPLICATION_CREDENTIALS` on the VPS today, the metadata server on a GCE VM
   * later, and no code change between them. It stays injectable so a test needs no credential.
   */
  constructor(
    private readonly projectId: string,
    private readonly tokens: AccessTokenSource = new AdcTokenSource(),
    private readonly options: SecretManagerOptions = {},
  ) {
    super();
  }

  override async fetch(name: string): Promise<string> {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;

    const version = this.options.version ?? "latest";
    const base = this.options.endpoint ?? API;
    const url = `${base}/projects/${this.projectId}/secrets/${encodeURIComponent(name)}/versions/${version}:access`;

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${await this.tokens.token()}` },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new InternalError({
        // The name and the status. Not the body: an error from a secret API is the last place to
        // be relaxed about what gets echoed into a log line.
        detail: {
          secret: name,
          status: response.status,
          project: this.projectId,
          reason: "Secret Manager refused the read",
        },
      });
    }

    const parsed = payloadSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new InternalError({
        detail: { secret: name, reason: "the secret response was not the shape we expect" },
      });
    }

    // Base64 in the wire format, and it may legitimately hold bytes that are not text — a DSN is
    // text, a wrapped key is not. `utf8` is right for everything a configuration value can be.
    const value = Buffer.from(parsed.data.payload.data, "base64").toString("utf8");
    this.cache.set(name, value);
    return value;
  }
}
