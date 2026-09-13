import { InternalError } from "@idenzy/core/errors";
import type { Clock } from "@idenzy/core/time/clock";
import { z } from "zod";

/**
 * An access token for calling a Google API as this service.
 *
 * A port rather than a call, for the usual two reasons: a test needs a seam that does not require a
 * metadata server, and a deployment that is not on Cloud Run one day will need a different source
 * without anything above having to know.
 */
export abstract class AccessTokenSource {
  abstract token(): Promise<string>;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
});

const METADATA_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const FETCH_TIMEOUT_MS = 3_000;

/**
 * How much of a token's life is given away rather than used.
 *
 * A token that expires between our check and the API's is an error we would report as a queue
 * failure, so the last minute is not spent. Sixty seconds against an hour costs nothing.
 */
const EXPIRY_SKEW_SECONDS = 60;

export interface MetadataTokenOptions {
  /** The metadata endpoint, so a test can stand in for it. Not settable from the environment. */
  readonly url?: string;
  readonly timeoutMs?: number;
}

/**
 * The token Cloud Run already has, from the metadata server.
 *
 * There is no credential to configure and none to leak: the platform holds the service account and
 * this asks for a token minted from it, which is the whole reason keyless identity is the shape we
 * use (PROJECT.md 4.11). Plain http is correct here and only here — the metadata server is a
 * link-local address the platform owns, not a network hop.
 *
 * Cached until it is nearly expired, because it is asked for once per retry task and a service
 * account token lasts an hour. Nothing locks around the refresh: two concurrent misses cost one extra
 * request to a local endpoint, and a mutex to avoid that would be more moving parts than it saves.
 */
export class MetadataTokenSource extends AccessTokenSource {
  private cached: { readonly value: string; readonly expiresAtMs: number } | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly options: MetadataTokenOptions = {},
  ) {
    super();
  }

  override async token(): Promise<string> {
    const held = this.cached;
    if (held !== null && held.expiresAtMs > this.clock.nowMs()) return held.value;

    const response = await fetch(this.options.url ?? METADATA_URL, {
      headers: { "metadata-flavor": "Google" },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new InternalError({
        detail: { component: "metadata-server", status: response.status },
      });
    }

    const parsed = tokenSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new InternalError({
        detail: { component: "metadata-server", reason: "the token response was not understood" },
      });
    }
    this.cached = {
      value: parsed.data.access_token,
      expiresAtMs: this.clock.nowMs() + (parsed.data.expires_in - EXPIRY_SKEW_SECONDS) * 1000,
    };
    return parsed.data.access_token;
  }
}
