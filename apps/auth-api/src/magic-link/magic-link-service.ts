import { AppConfig } from "@idenzy/config/app-config";
import {
  ChallengeExpiredError,
  ChallengeInvalidError,
  RedirectUriNotAllowedError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { AuthCodeRepository } from "@idenzy/persistence/repository/auth-code-repository";
import { MagicLinkRepository } from "@idenzy/persistence/repository/magic-link-repository";
import { RedirectUriRepository } from "@idenzy/persistence/repository/redirect-uri-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { TemplateType } from "@idenzy/protocol/enums/delivery";
import type { ChallengeStarted } from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";
import { Mailer } from "../delivery/mailer.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/** The allowlist kind magic links are registered under. OAuth uses its own. */
export const MAGIC_LINK_REDIRECT = "magic_link";

/**
 * Issuing and following a magic link (PROJECT.md 4.7).
 *
 * The shape is the whole design. We mail a link to our own API; clicking it validates
 * the token and 302s to a URI the customer registered, carrying a single-use code their
 * SDK exchanges for a session. We render nothing, so the anti-scanner confirmation step
 * is a route in the customer's application, which is the only place it can be made to
 * look like their product.
 *
 * The code in the redirect exists because a session in a URL is a session in browser
 * history, in a Referer header and in the customer's own access logs. A code is worth
 * nothing without a POST, and worth nothing twice.
 */
@Injectable()
export class MagicLinkService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly encryptor: FieldEncryptor,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
  ) {}

  async start(context: FlowContext, email: string, redirectUri: string): Promise<ChallengeStarted> {
    const tenant = tenantContextFrom(context);
    const ttl = this.config.get("MAGIC_LINK_TTL_SECONDS");
    const expiresAt = this.clock.inSeconds(ttl);
    const token = generateOpaqueToken();

    const tokenId = await this.uow.run(tenant, async (tx) => {
      // Checked before anything is issued, and never echoed back in the error: an
      // open-redirect probe should learn nothing from the response it gets.
      const allowed = await new RedirectUriRepository(tx, tenant).isAllowed(
        MAGIC_LINK_REDIRECT,
        redirectUri,
      );
      if (!allowed) throw new RedirectUriNotAllowedError();

      const user = await new UserRepository(tx, tenant).findByEmail(email);
      return new MagicLinkRepository(tx, tenant).issue({
        tokenHash: hashToken(token),
        // Recorded when we already know it, so a user's outstanding links are findable.
        // Null is normal: a link to an address with no account is how sign-up works here.
        userId: user?.id ?? null,
        targetEncrypted: this.encryptor.encrypt(email, context.projectId),
        redirectUri,
        expiresAt,
      });
    });

    await this.mailer.deliver(context, TemplateType.MagicLink, email, {
      link: this.linkFor(token),
      expiresInSeconds: ttl,
    });

    return {
      challengeId: PublicId.encode(IdPrefix.Challenge, tokenId).value,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Follows a clicked link and returns where to send the browser.
   *
   * A bad token cannot produce a redirect, because the token is what names the
   * destination. That is not a gap: an error we could redirect anywhere would be the
   * open redirect this design exists to avoid, so an unusable link ends as JSON.
   */
  async follow(context: FlowContext, token: string): Promise<string> {
    const tenant = tenantContextFrom(context);
    const ttl = this.config.get("AUTH_CODE_TTL_SECONDS");
    const code = generateOpaqueToken();

    const redirectUri = await this.uow.run(tenant, async (tx) => {
      const links = new MagicLinkRepository(tx, tenant);
      const link = await links.findByHash(hashToken(token));
      if (link === null || link.consumedAt !== null) throw new ChallengeInvalidError();
      if (link.expiresAt <= this.clock.now()) throw new ChallengeExpiredError();
      // A mail scanner and the user can arrive together, and only one of them wins.
      if (!(await links.consume(link.id, this.clock.now()))) throw new ChallengeInvalidError();

      const email = this.encryptor.decrypt(link.targetEncrypted, context.projectId);
      const users = new UserRepository(tx, tenant);
      const existing = await users.findByEmail(email);
      const user =
        existing ??
        (await users.create({
          email,
          // Clicking the link proves the same thing typing the code does.
          emailVerified: true,
          phone: null,
          passwordHash: null,
          passwordAlgoVersion: null,
          displayName: null,
          avatarUrl: null,
        }));
      existing?.assertCanSignIn(this.clock);
      if (existing !== null && !existing.emailVerified) {
        await users.setEmailVerified(existing.id, true);
      }

      await new AuthCodeRepository(tx, tenant).issue({
        userId: user.id,
        codeHash: hashToken(code),
        amr: [AuthMethod.MagicLink],
        redirectUri: link.redirectUri,
        // No PKCE, and this is the one flow where that is correct rather than missing. A
        // link is started in one browser and clicked in another, often a mail app's, so a
        // verifier held by the starting browser would fail the normal case every time.
        // Single use, a two-minute life and a redirect pinned at issue carry this one.
        codeChallenge: null,
        expiresAt: this.clock.inSeconds(ttl),
      });
      return link.redirectUri;
    });

    const destination = new URL(redirectUri);
    destination.searchParams.set("code", code);
    return destination.toString();
  }

  private linkFor(token: string): string {
    const url = new URL("/v1/auth/magic-link/callback", this.config.get("ISSUER_BASE_URL"));
    url.searchParams.set("token", token);
    return url.toString();
  }
}
