import {
  InvalidApiKeyError,
  MissingCredentialsError,
  SecretKeyNotPermittedError,
} from "@idenzy/core/errors";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import { isApiKey, isPublishableKey, isSecretKey } from "@idenzy/protocol/schemas/common";
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { Surface, surfaceOf } from "../http/surface.js";
import { ProjectResolver, type ResolvedProject } from "./project-resolver.js";

export const PUBLIC_ROUTE = "idenzy:public-route";

/** Marks a route as reachable without a tenant. Health and discovery only. */
export const NoTenant = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

export const FLOW_TENANT = "idenzy:flow-tenant";

/** The one-time secret a browser brings back to a route it is sent to: a link's token, a state. */
export type FlowSecret = "magic_link_token" | "oauth_state";

/**
 * Marks a route a browser is *sent* to, by an email or a provider, carrying a one-time secret
 * and nothing else: no publishable key, and a Host that is the shared API host unless the
 * project has an auth domain. The secret was stored with its project when the flow started, so
 * it names the project, and it is unguessable, so naming one is all it can do: the route still
 * checks the flow (expiry, single use) inside that project.
 */
export const TenantFromFlow = (secret: FlowSecret): MethodDecorator =>
  SetMetadata(FLOW_TENANT, secret);

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
    /** True on @NoTenant routes, so the CORS layer can answer them without credentials. */
    publicRoute?: boolean;
    /**
     * The full resolution result, which carries more than the tenant scope does: the CORS
     * layer needs the origin allowlist and cookie mode needs to know whether a verified
     * auth domain exists. TenantContext belongs to persistence and should not learn about
     * either.
     */
    project?: ResolvedProject;
  }
}

/** How the caller named their project. Which one it is decides more than the lookup. */
type Credential =
  | { readonly from: "publishable-header"; readonly key: string }
  | { readonly from: "authorization"; readonly key: string }
  | { readonly from: "host"; readonly host: string }
  | { readonly from: "flow"; readonly secret: FlowSecret; readonly value: string };

/**
 * Resolves the project from the publishable-key header, an API key, or the Host header, and
 * refuses the request if it cannot (PROJECT.md 9.3 step 3).
 *
 * The order is **first present wins, not a fallback chain**, and the difference matters. If
 * a publishable key is presented but is malformed or resolves to nothing, that is a hard
 * failure. Falling through to Host would mean a request that named project A silently
 * executing against whatever project the Host happens to map to.
 *
 * The header exists because `Authorization` cannot carry both things at once. On a signed-in
 * request it holds the user's access token, so before this the eleven session-protected
 * routes had no way to name their project except by Host, which is why they only worked
 * behind a custom auth domain.
 */
@Injectable()
export class TenantResolutionGuard implements CanActivate {
  constructor(
    private readonly resolver: ProjectResolver,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    /*
     * The dashboard surface resolves its scope from the path and the caller's membership,
     * not from a key, so there is no tenant for this guard to find and demanding one would
     * refuse every management route. It is skipped rather than made permissive: `MembershipGuard`
     * is what authorises those, and it is opt-in per route the way this one is opt-out.
     *
     * Auth is the default in `surfaceOf`, so a route nobody classified still arrives here and
     * still needs a tenant.
     */
    const surface = surfaceOf(request.url);
    if (surface === Surface.Dashboard || surface === Surface.Operator) return true;

    const isPublic =
      surface === Surface.Public ||
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    if (isPublic) {
      request.publicRoute = true;
      return true;
    }

    const credential = this.credential(request, context);
    const resolved = await this.resolve(credential);
    request.project = resolved;

    request.tenant = new TenantContext(
      resolved.projectId,
      request.id,
      // A publishable key identifies the application, not an actor, so it audits as a user
      // exactly as a Host-resolved request does. Only a secret key is a machine acting.
      credential.from === "authorization" && isSecretKey(credential.key) ? "api_key" : "user",
      null,
      null,
    );
    return true;
  }

  private resolve(credential: Credential): Promise<ResolvedProject> {
    switch (credential.from) {
      case "publishable-header":
        return this.resolver.byPublishableKey(credential.key);
      case "authorization":
        return this.resolver.byApiKey(credential.key);
      case "host":
        return this.resolver.byHost(credential.host);
      case "flow":
        return credential.secret === "magic_link_token"
          ? this.resolver.byMagicLinkToken(credential.value)
          : this.resolver.byOAuthState(credential.value);
    }
  }

  /**
   * The first credential the request presents, whatever it turns out to be worth.
   *
   * The prefix checks on the header happen here, before any lookup, so a real secret key and
   * a fabricated one produce the same answer after the same work. A check that ran after the
   * lookup would tell whoever asked whether the key they pasted was genuine.
   */
  private credential(request: FastifyRequest, context: ExecutionContext): Credential {
    const presented = request.headers[IdenzyHeader.PublishableKey];
    const key = typeof presented === "string" ? presented.trim() : "";
    if (key.length > 0) {
      if (isSecretKey(key)) throw new SecretKeyNotPermittedError();
      if (!isPublishableKey(key)) throw new InvalidApiKeyError();
      return { from: "publishable-header", key };
    }

    const bearer = this.bearerKey(request);
    if (bearer !== null) return { from: "authorization", key: bearer };

    // Before Host: on the shared host Host names nothing, and where the project has an auth
    // domain both name the same project.
    const flow = this.reflector.get<FlowSecret | undefined>(FLOW_TENANT, context.getHandler());
    const secret = flow === undefined ? null : flowSecretOf(request, flow);
    if (flow !== undefined && secret !== null) return { from: "flow", secret: flow, value: secret };

    const host = request.headers.host;
    if (host !== undefined) return { from: "host", host };

    throw new MissingCredentialsError();
  }

  /**
   * A key on `Authorization`, which stays supported for server-side callers and for clients
   * written before the header existed. A user access token is not one: it is resolved by Host
   * and authenticated later by SessionGuard, which is why this tests the prefix rather than
   * trying a lookup and seeing what happens.
   */
  private bearerKey(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length).trim();
    return isApiKey(token) ? token : null;
  }
}

/** The secret a flow's browser brings back: a link's `token` in the query, an OAuth `state` in
 *  the query or, for a provider that posts its callback (Apple), in the form body. */
function flowSecretOf(request: FastifyRequest, flow: FlowSecret): string | null {
  const name = flow === "magic_link_token" ? "token" : "state";
  for (const source of [request.query, request.body]) {
    if (typeof source !== "object" || source === null) continue;
    const value = (source as Record<string, unknown>)[name];
    if (typeof value === "string" && value.length > 0 && value.length <= 512) return value;
  }
  return null;
}
