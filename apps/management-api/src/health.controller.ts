import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("healthz")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("readyz")
  ready(): { status: "ok" } {
    return { status: "ok" };
  }
}
