import { MissingCredentialsError, ValidationFailedError } from "@idenzy/core/errors/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { IssuedSession } from "@idenzy/domain/ports/auth-flow";
import {
  type AuthorizationStarted,
  type ExchangeCode,
  exchangeCodeSchema,
  type OauthCallback,
  oauthCallbackSchema,
  type StartOauth,
  startOauthSchema,
} from "@idenzy/protocol/schemas/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { SessionCreated } from "@idenzy/protocol/schemas/session";
import { Body, Controller, Get, HttpCode, Param, Post, Query, Redirect, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { RequireSession, type SessionPrincipal } from "../session/session.guard.js";
import { flowContextFrom } from "../tenancy/flow-context.js";
import { OAuthCodeFlow } from "./oauth-code.flow.js";
import { OAuthService } from "./oauth-service.js";

interface Redirection {
  readonly url: string;
  readonly statusCode: number;
}

/**
 * Social sign-in (PROJECT.md 4.6).
 *
 * Four routes and one absence. Start sends the browser to the provider, the callback
 * brings it back and forwards it to the customer's own route with a single-use code, and
 * exchange turns that code into a session. The absence is any page of ours: the only
 * HTML in this flow belongs to the identity provider.
 *
 * The callback answers both verbs because Apple posts it rather than redirecting to it
 * whenever a scope beyond `openid` was requested. Handling only GET works in testing
 * with a bare `openid` scope and breaks the moment a customer asks for the user's name.
 */
@Controller("v1/auth/oauth")
export class OAuthController {
  constructor(
    private readonly service: OAuthService,
    private readonly flow: OAuthCodeFlow,
  ) {}

  /**
   * A plain browser navigation, so it takes its parameters from the query and answers
   * with a redirect. Nothing here needs a session: this is the sign-in path.
   */
  @Get(":provider/start")
  @Redirect(undefined, 302)
  async start(
    @Req() request: FastifyRequest,
    @Param("provider") provider: string,
    @Query(new ZodValidationPipe(startOauthSchema)) query: StartOauth,
  ): Promise<Redirection> {
    const url = await this.service.start(
      flowContextFrom(request),
      provider,
      query.redirectUri,
      null,
    );
    return { url, statusCode: 302 };
  }

  /**
   * Attaching a provider to an account that already exists.
   *
   * JSON rather than a redirect, and that is what makes it safe without cookie mode: a
   * browser navigation cannot carry an access token, so the SDK asks for the URL with
   * the session it holds and navigates itself. The user id comes from the guard and is
   * pinned to the flow, so the callback links to the caller and not to whoever the
   * provider turns out to be.
   */
  @Post(":provider/link")
  @RequireSession()
  @HttpCode(200)
  async link(
    @Req() request: FastifyRequest,
    @Param("provider") provider: string,
    @Body(new ZodValidationPipe(startOauthSchema)) body: StartOauth,
  ): Promise<AuthorizationStarted> {
    const authorizationUrl = await this.service.start(
      flowContextFrom(request),
      provider,
      body.redirectUri,
      principalOf(request).userId,
    );
    return { authorizationUrl };
  }

  @Get(":provider/callback")
  @Redirect(undefined, 302)
  callback(
    @Req() request: FastifyRequest,
    @Param("provider") provider: string,
    @Query(new ZodValidationPipe(oauthCallbackSchema)) query: OauthCallback,
  ): Promise<Redirection> {
    return this.complete(request, provider, query);
  }

  /** Apple, and anything else using `response_mode=form_post`. */
  @Post(":provider/callback")
  @Redirect(undefined, 302)
  callbackPosted(
    @Req() request: FastifyRequest,
    @Param("provider") provider: string,
    @Body(new ZodValidationPipe(oauthCallbackSchema)) body: OauthCallback,
  ): Promise<Redirection> {
    return this.complete(request, provider, body);
  }

  @Post("exchange")
  @HttpCode(200)
  async exchange(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(exchangeCodeSchema)) body: ExchangeCode,
  ): Promise<SessionCreated> {
    const issued = await this.flow.authenticate(flowContextFrom(request), body);
    return present(issued);
  }

  private async complete(
    request: FastifyRequest,
    provider: string,
    callback: OauthCallback,
  ): Promise<Redirection> {
    // A user who declined at the consent screen. There is no code to exchange and no
    // flow to complete, so this is a validation failure rather than a provider error;
    // the customer's UI reads the reason from the code it was given.
    if (callback.code === undefined) {
      throw new ValidationFailedError({
        message: "The provider did not return an authorization code.",
        fields: [{ path: "code", code: callback.error ?? "missing" }],
      });
    }
    const url = await this.service.finish(
      flowContextFrom(request),
      provider,
      callback.state,
      callback.code,
    );
    return { url, statusCode: 302 };
  }
}

function principalOf(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (principal === undefined) throw new MissingCredentialsError();
  return principal;
}

function present(issued: IssuedSession): SessionCreated {
  return {
    user: issued.user.toPublic(),
    sessionId: PublicId.encode(IdPrefix.Session, issued.sessionId).value,
    accessToken: issued.accessToken,
    accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
    refreshToken: issued.refreshToken,
  };
}
