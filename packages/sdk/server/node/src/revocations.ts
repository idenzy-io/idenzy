import { AccessTokenInvalidError } from "@idenzy/core/errors";
import {
  REVOCATION_SNAPSHOT_TYP,
  type RevocationSnapshot,
  revocationSnapshotSchema,
} from "@idenzy/protocol/schemas/revocation";
import { jwtVerify } from "jose";
import type { VerifiedAccessToken } from "./idenzy-node.js";
import type { JwksSource } from "./jwks.js";

export interface RevocationCacheOptions {
  /** The auth API's base URL, the same one the verifier uses. */
  readonly issuerUrl: string;
  /** The project whose set this is. The snapshot must name it as its audience. */
  readonly projectId: string;
  /**
   * The project's secret key.
   *
   * Server-side only. The set names users whose sessions were all ended and when, so it is
   * not published to anything a browser can reach, and a secret key in a browser bundle is
   * the mistake the publishable key exists to prevent.
   */
  readonly secretKey: string;
  /**
   * How often to ask. The delay a revocation takes to reach this process is roughly this,
   * so it is the number to move if seconds matter; it is not free, because every instance
   * polls.
   */
  readonly pollIntervalMs?: number;
  /** For tests and for a deployment that routes outbound calls through its own client. */
  readonly fetch?: typeof globalThis.fetch;
}

/** What the cache knows about its own freshness, for a customer who wants to act on it. */
export interface RevocationStatus {
  /** When a poll last succeeded, or null if none ever has. */
  readonly lastSuccessAt: Date | null;
  /** When the held snapshot stops being trustworthy, or null if there is none. */
  readonly expiresAt: Date | null;
  /**
   * Whether the held snapshot is past its expiry or absent.
   *
   * True does not mean "everything is revoked" and it does not mean "nothing is". It means
   * this process cannot answer the question, which is a third state and the caller's to
   * decide about.
   */
  readonly stale: boolean;
}

/**
 * A snapshot as the request path reads it: a set of sessions and a map of watermarks.
 *
 * Built once per poll rather than searched per request, because the set lists every
 * revocation inside its retention window and a request should cost a hash lookup whatever
 * the size of that list. An array scan is fine at ten entries and is a CPU bill per request
 * at a hundred thousand.
 */
interface RevocationIndex {
  readonly sessions: ReadonlySet<string>;
  readonly users: ReadonlyMap<string, number>;
  readonly projectRevokedBefore: number | null;
}

const EMPTY: RevocationIndex = {
  sessions: new Set(),
  users: new Map(),
  projectRevokedBefore: null,
};

function indexOf(snapshot: RevocationSnapshot): RevocationIndex {
  const users = new Map<string, number>();
  // The latest watermark wins should a user appear twice: it revokes everything the earlier
  // one did and more.
  for (const { userId, revokedBefore } of snapshot.users) {
    users.set(userId, Math.max(revokedBefore, users.get(userId) ?? revokedBefore));
  }
  return {
    sessions: new Set(snapshot.sessions),
    users,
    projectRevokedBefore: snapshot.projectRevokedBefore,
  };
}

/**
 * An in-process copy of a project's revocation set (ADR-0009).
 *
 * It polls the published snapshot and answers from memory, so asking whether a token is
 * revoked costs a hash lookup and no I/O. That is the whole point: a lookup on the request
 * path would put our latency and our availability inside the customer's request, which is
 * the property offline verification exists to sell.
 *
 * It is opt-in. A customer who does not build one keeps a package that makes no network call
 * of its own beyond the key set.
 *
 * Failures are held rather than thrown. A poll that fails leaves the last good snapshot in
 * place and shows up in `status()`; the exposure that returns is the one the customer had
 * before they turned this on, which is a revocation waiting for the token to expire. Throwing
 * instead would turn an outage of ours into an outage of theirs, on every request, which is
 * strictly worse than the delay it was avoiding.
 */
export class RevocationCache {
  private readonly url: string;
  private readonly intervalMs: number;
  private readonly request: typeof globalThis.fetch;
  private snapshot: RevocationIndex = EMPTY;
  private etag: string | null = null;
  private expiresAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly options: RevocationCacheOptions,
    private readonly keys: JwksSource,
  ) {
    this.url = new URL(
      "v1/revocations",
      options.issuerUrl.endsWith("/") ? options.issuerUrl : `${options.issuerUrl}/`,
    ).toString();
    this.intervalMs = options.pollIntervalMs ?? 5_000;
    this.request = options.fetch ?? globalThis.fetch;
  }

  /**
   * Fetches once, then keeps fetching.
   *
   * Awaiting it means the first request the process serves is answered from a real snapshot
   * rather than from an empty one. It resolves either way: a first poll that failed is a
   * cache that reports stale, not a server that will not start.
   *
   * The timer is unreferenced, so holding one of these never keeps a process alive on its
   * own. A script that finishes still exits.
   */
  async start(): Promise<void> {
    await this.refresh();
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  /** Stops polling. Safe to call twice, and safe to call having never started. */
  close(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  status(): RevocationStatus {
    return {
      lastSuccessAt: this.lastSuccessAt,
      expiresAt: this.expiresAt,
      stale: this.expiresAt === null || this.expiresAt.getTime() <= Date.now(),
    };
  }

  /**
   * Whether this token is dead by any of the three routes the set carries.
   *
   * A session entry kills every token naming it, however recently one was minted, because a
   * refresh mints a new token for the same session. The watermarks kill tokens issued before
   * an instant, compared strictly against `iat` so a token minted inside the same second
   * survives: `iat` is only second-accurate, and the alternative to under-revoking by under a
   * second is revoking tokens issued after the event, which no client can recover from.
   *
   * A stale cache answers false. That is the documented fail-open (ADR-0009), and `status()`
   * is how a caller who would rather fail closed finds out.
   */
  isRevoked(token: Pick<VerifiedAccessToken, "sessionId" | "userId" | "issuedAt">): boolean {
    if (this.status().stale) return false;
    if (this.snapshot.sessions.has(token.sessionId)) return true;

    const issuedAt = Math.floor(token.issuedAt.getTime() / 1000);
    const user = this.snapshot.users.get(token.userId);
    if (user !== undefined && issuedAt < user) return true;
    const project = this.snapshot.projectRevokedBefore;
    return project !== null && issuedAt < project;
  }

  /** One poll. Never throws, and never replaces a good snapshot with a bad one. */
  private async refresh(): Promise<void> {
    try {
      const response = await this.request(this.url, {
        headers: {
          authorization: `Bearer ${this.options.secretKey}`,
          ...(this.etag === null ? {} : { "if-none-match": this.etag }),
        },
      });

      // Nothing has changed, so the snapshot we hold is current. Its expiry is not extended
      // by that: a 304 says the content matches, not that the signature we hold is fresh.
      if (response.status === 304) {
        this.lastSuccessAt = new Date();
        return;
      }
      if (!response.ok) return;

      const verified = await this.verify(await response.text());
      this.snapshot = indexOf(verified.snapshot);
      this.expiresAt = verified.expiresAt;
      this.etag = response.headers.get("etag");
      this.lastSuccessAt = new Date();
    } catch {
      // Held, not thrown. `status()` is where this becomes visible.
    }
  }

  /**
   * Checks the signature, the media type and the audience before believing any of it.
   *
   * The media type is not a formality. The same project key signs access tokens, so a
   * signature alone does not say which kind of statement this is, and a verifier that
   * accepted either would let one be replayed as the other (RFC 8725 section 3.11).
   */
  private async verify(body: string): Promise<{ snapshot: RevocationSnapshot; expiresAt: Date }> {
    const { payload } = await jwtVerify(body, this.keys.resolver(), {
      issuer: this.options.issuerUrl,
      audience: this.options.projectId,
      algorithms: ["ES256"],
      typ: REVOCATION_SNAPSHOT_TYP,
      requiredClaims: ["exp"],
    });

    const parsed = revocationSnapshotSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AccessTokenInvalidError({ detail: { reason: "unreadable revocation snapshot" } });
    }
    return { snapshot: parsed.data, expiresAt: new Date((payload.exp ?? 0) * 1000) };
  }
}
