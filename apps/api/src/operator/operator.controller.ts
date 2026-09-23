import { PublicId } from "@idenzy/core/value-objects/public-id";
import { OperatorOrgReader } from "@idenzy/persistence/repository/operator-org-reader";
import { StaffRole } from "@idenzy/protocol/enums/staff";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import {
  type OperatorMe,
  type OperatorOrgList,
  operatorOrgQuerySchema,
} from "@idenzy/protocol/schemas/operator";
import { Controller, Get, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { operatorOf, RequireStaff } from "./staff.guard.js";

/**
 * The operator console's own routes (ADR-0018).
 *
 * `me` is how the console learns, after sign-in, whether the Google account that signed in is a
 * member of staff at all: a 401 there is the answer "no".
 */
@Controller("v1/operator")
export class OperatorController {
  constructor(private readonly orgs: OperatorOrgReader) {}

  @Get("me")
  @RequireStaff(StaffRole.Support)
  me(@Req() request: FastifyRequest): OperatorMe {
    const operator = operatorOf(request);
    return { email: operator.email, role: operator.role };
  }

  /** Organisations by name, or by id in either form; the newest first when the query is empty. */
  @Get("orgs")
  @RequireStaff(StaffRole.Support)
  async searchOrgs(
    @Query(new ZodValidationPipe(operatorOrgQuerySchema)) params: { query: string },
  ): Promise<OperatorOrgList> {
    const rows = await this.orgs.search(uuidOrText(params.query), 50);
    return {
      orgs: rows.map((row) => ({
        id: PublicId.encode(IdPrefix.Org, row.id).value,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}

/** An `org_` public id becomes the uuid it encodes; anything else is searched as a name. */
function uuidOrText(query: string): string {
  const trimmed = query.trim();
  if (!trimmed.startsWith(`${IdPrefix.Org}_`)) return trimmed;
  try {
    return PublicId.parse(IdPrefix.Org, trimmed).uuid;
  } catch {
    return trimmed;
  }
}
