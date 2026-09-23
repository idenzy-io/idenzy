import { StaffRole } from "@idenzy/protocol/enums/staff";
import type { OperatorMe } from "@idenzy/protocol/schemas/operator";
import { Controller, Get, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { operatorOf, RequireStaff } from "./staff.guard.js";

/**
 * The operator console's own identity route (ADR-0018). The console calls it after sign-in: a 401
 * here is how it learns the Google account that signed in is not a member of staff.
 */
@Controller("v1/operator")
export class OperatorController {
  @Get("me")
  @RequireStaff(StaffRole.Support)
  me(@Req() request: FastifyRequest): OperatorMe {
    const operator = operatorOf(request);
    return { email: operator.email, role: operator.role };
  }
}
