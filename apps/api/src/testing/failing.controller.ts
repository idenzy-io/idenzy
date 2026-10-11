import { InvalidCredentialsError, MissingCredentialsError } from "@idenzy/core/errors";
import { Controller, Get, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { TenantFromFlow } from "../tenancy/tenant-resolution.guard.js";

/** Not an Error at all, which is a real failure mode: libraries throw plain values. */
class UnrecognizedFailure {
  constructor(readonly message: string) {}
}

/**
 * Routes that always fail, so the exception filter's output is covered by tests rather
 * than only its happy path.
 *
 * Registered by the test module only; AppModule never imports it.
 */
@Controller("test")
export class FailingController {
  @Get("boom")
  boom(): never {
    throw new InvalidCredentialsError({ detail: { userId: "usr_secret", note: "internal" } });
  }

  /**
   * Echoes whichever tenant the guard resolved.
   *
   * Needed because "the request was refused" and "the request ran against the wrong project"
   * are different failures, and only the second one is silent. A test that could see just the
   * status code could not tell them apart.
   */
  @Get("tenant")
  tenant(@Req() request: FastifyRequest): { projectId: string; actor: string } {
    const tenant = request.tenant;
    if (tenant === undefined) throw new MissingCredentialsError();
    return { projectId: tenant.projectId, actor: tenant.actorType };
  }

  /** As `tenant`, on a route a clicked magic link is sent to. */
  @Get("tenant-from-link")
  @TenantFromFlow("magic_link_token")
  tenantFromLink(@Req() request: FastifyRequest): { projectId: string; actor: string } {
    return this.tenant(request);
  }

  @Get("unhandled")
  unhandled(): never {
    // Deliberately not an IdenzyError, and deliberately not even an Error, to prove the
    // filter turns anything it does not recognize into a generic 500.
    throw new UnrecognizedFailure("an unexpected internal failure with a revealing message");
  }
}
