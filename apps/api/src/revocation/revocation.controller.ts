import { createHash } from "node:crypto";
import { RevocationSet } from "@idenzy/cache/revocation-set";
import { AppConfig } from "@idenzy/config/app-config";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import {
  REVOCATION_SNAPSHOT_TYP,
  type RevocationSnapshot,
} from "@idenzy/protocol/schemas/revocation";
import { Controller, Get, Header, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { REVOCATION_SKEW_SECONDS } from "../cache/cache.module.js";
import { RequireSecretKey } from "../tenancy/secret-key.guard.js";

/**
 * How long a snapshot may be trusted once signed.
 *
 * Short, because this is the only thing standing between a withheld snapshot and
 * revocation silently ceasing to work: anything on the path can serve an old copy, and an
 * expiry is what turns that from invisible into stale (ADR-0009). Long enough that a
 * client polling on its own schedule is never holding an expired one between polls.
 */
const SNAPSHOT_TTL_SECONDS = 120;

/**
 * The published revocation set (PROJECT.md 4.2, ADR-0009).
 *
 * A server SDK polls this and checks an in-process copy, so a revocation check on a
 * customer's request path costs no network call. That is the whole design: a lookup they
 * had to make per request would put our latency and our availability inside their request,
 * which is the property offline verification exists to sell.
 *
 * Secret key only. The payload names users whose sessions were all ended and when, and a
 * project id travels in every access token's `aud`, so a public endpoint would let anyone
 * holding one token watch that project's security events indefinitely.
 */
@Controller("v1/revocations")
export class RevocationController {
  constructor(
    private readonly set: RevocationSet,
    private readonly tokens: TokenIssuer,
    private readonly config: AppConfig,
  ) {}

  /**
   * The whole set, signed, as a compact JWS.
   *
   * Signed as well as authenticated, because TLS ends at whatever the customer runs it
   * behind and the signature is what makes the payload's origin checkable at the SDK. The
   * key is the project's own, so a client verifies it with the JWKS it already caches.
   *
   * `private` rather than `public`: a shared cache keyed on the URL would serve one
   * project's set to another's key. The ETag is what makes polling cheap instead, since a
   * set that has not changed answers 304 with no body and no signature.
   */
  @Get()
  @RequireSecretKey()
  @Header("cache-control", "private, max-age=5, must-revalidate")
  async snapshot(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string | undefined> {
    const tenant = request.tenant;
    if (tenant === undefined) return undefined;

    const set = await this.set.snapshot(tenant.projectId);
    const body: RevocationSnapshot = {
      sessions: [...set.sessions],
      users: set.users.map((user) => ({ ...user })),
      projectRevokedBefore: set.projectRevokedBefore,
      retentionSeconds: this.config.get("ACCESS_TOKEN_TTL_SECONDS") + REVOCATION_SKEW_SECONDS,
    };

    // Over the content and not the signature: a fresh signature every poll would change
    // the bytes each time and make the ETag useless, which is the one thing keeping a
    // fleet of pollers off our origin.
    const etag = `"${createHash("sha256").update(JSON.stringify(body)).digest("base64url")}"`;
    reply.header("etag", etag);
    if (request.headers["if-none-match"] === etag) {
      reply.status(304);
      return undefined;
    }

    reply.header("content-type", "application/jwt");
    const issued = await this.tokens.issueStatement(
      REVOCATION_SNAPSHOT_TYP,
      PublicId.encode(IdPrefix.Project, tenant.projectId).value,
      body,
      SNAPSHOT_TTL_SECONDS,
    );
    return issued.token;
  }
}
