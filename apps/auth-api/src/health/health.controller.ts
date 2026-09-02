import { Controller, Get } from "@nestjs/common";
import { NoTenant } from "../tenancy/tenant-resolution.guard.js";

/**
 * Liveness and readiness.
 *
 * Split deliberately: /healthz says the process is up, /readyz says it can serve. A
 * single endpoint that checks dependencies makes a database blip restart every
 * instance, turning a degradation into an outage.
 */
@Controller()
export class HealthController {
  @Get("healthz")
  @NoTenant()
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("readyz")
  @NoTenant()
  ready(): { status: "ok" } {
    return { status: "ok" };
  }
}
