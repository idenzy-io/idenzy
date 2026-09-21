import {
  InvalidApiKeyError,
  MissingCredentialsError,
  SecretKeyNotPermittedError,
  WrongRegionError,
} from "@idenzy/core/errors";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import {
  isApiKey,
  isPublishableKey,
  isSecretKey,
  parseApiKey,
} from "@idenzy/protocol/schemas/common";
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { LocalCell } from "./local-cell.js";
import { ProjectResolver, type ResolvedProject } from "./project-resolver.js";

export const PUBLIC_ROUTE = "idenzy:public-route";

/** Marks a route as reachable without a tenant. Health and discovery only. */
export const NoTenant = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

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
  | { readonly from: "host"; readonly host: string };

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
    private readonly cell: LocalCell,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      request.publicRoute = true;
      return true;
    }

    const credential = this.credential(request);
    const resolved = await this.resolve(credential);

    /*
     * The second line of the cross-cell refusal, and the one that catches the Host path.
     *
     * A key was already checked on its own text in `credential()`, before any lookup. This is for
     * the requests that present no key at all — resolved by Host, on a custom auth domain — where
     * there is nothing to check until the project is known. It also stands as a backstop for the
     * first: a key whose segment says `us1` on a row whose cell says otherwise is a provisioning
     * fault, and serving it would be exactly the accidental jurisdiction transit 4.13.5 forbids.
     */
    if (!(await this.cell.servesId(resolved.cellId))) {
      throw new WrongRegionError({
        detail: { servedBy: this.cell.code, from: credential.from },
      });
    }
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
    }
  }

  /**
   * The first credential the request presents, whatever it turns out to be worth.
   *
   * The prefix checks on the header happen here, before any lookup, so a real secret key and
   * a fabricated one produce the same answer after the same work. A check that ran after the
   * lookup would tell whoever asked whether the key they pasted was genuine.
   */
  private credential(request: FastifyRequest): Credential {
    const presented = request.headers[IdenzyHeader.PublishableKey];
    const key = typeof presented === "string" ? presented.trim() : "";
    if (key.length > 0) {
      if (isSecretKey(key)) throw new SecretKeyNotPermittedError();
      if (!isPublishableKey(key)) throw new InvalidApiKeyError();
      this.refuseAnotherCell(key);
      return { from: "publishable-header", key };
    }

    const bearer = this.bearerKey(request);
    if (bearer !== null) {
      this.refuseAnotherCell(bearer);
      return { from: "authorization", key: bearer };
    }

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
  /**
   * The first line of the cross-cell refusal: a key for another cell never becomes a query.
   *
   * §4.13.5 says routing refuses cross-cell access rather than proxying it, and refusing on the
   * string is the strongest form of that — the key is not hashed, no row is read, and nothing
   * about whether it is genuine is learned or leaked. It is also the only form that can say where
   * to go instead, because after a failed lookup there is nothing left to say it with.
   *
   * A key that does not parse is an `InvalidApiKeyError` rather than a wrong region: it names no
   * cell, so it is malformed rather than misdirected.
   */
  private refuseAnotherCell(key: string): void {
    const parsed = parseApiKey(key);
    if (parsed === null) throw new InvalidApiKeyError();
    if (!this.cell.servesCode(parsed.cell)) {
      throw new WrongRegionError({
        message: `This key belongs to region ${parsed.cell}, and this endpoint serves ${this.cell.code}.`,
        detail: { presented: parsed.cell, servedBy: this.cell.code },
      });
    }
  }

  private bearerKey(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length).trim();
    return isApiKey(token) ? token : null;
  }
}
