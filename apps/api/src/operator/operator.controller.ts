import { PublicId } from "@idenzy/core/value-objects/public-id";
import { OperatorOrgReader } from "@idenzy/persistence/repository/operator-org-reader";
import { StaffRole } from "@idenzy/protocol/enums/staff";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import {
  type OperatorInvoiceList,
  type OperatorMe,
  type OperatorOrgBilling,
  type OperatorOrgList,
  operatorOrgQuerySchema,
  type SetBillingMode,
  setBillingModeSchema,
} from "@idenzy/protocol/schemas/operator";
import { Body, Controller, Get, HttpCode, Param, Put, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { OperatorBillingService } from "./operator-billing-service.js";
import { operatorOf, RequireStaff } from "./staff.guard.js";

/**
 * The operator console's own routes (ADR-0018).
 *
 * `me` is how the console learns, after sign-in, whether the Google account that signed in is a
 * member of staff at all: a 401 there is the answer "no".
 */
@Controller("v1/operator")
export class OperatorController {
  constructor(
    private readonly orgs: OperatorOrgReader,
    private readonly billing: OperatorBillingService,
  ) {}

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

  /** Past-due invoices across every organisation, oldest first. Nothing acts on these by itself. */
  @Get("invoices/overdue")
  @RequireStaff(StaffRole.Support)
  async overdue(): Promise<OperatorInvoiceList> {
    const rows = await this.orgs.invoicesByStatus("past_due", 200);
    return {
      invoices: rows.map((row) => ({
        orgId: PublicId.encode(IdPrefix.Org, row.orgId).value,
        orgName: row.orgName,
        number: row.number,
        totalCents: row.totalCents,
        currency: row.currency,
        status: row.status,
        dueAt: row.dueAt?.toISOString() ?? null,
        hostedUrl: row.hostedUrl,
      })),
    };
  }

  /** One organisation's billing: its mode and terms, its balance and its invoices. */
  @Get("orgs/:orgId/billing")
  @RequireStaff(StaffRole.Support)
  async billingOf(
    @Param("orgId") orgId: string,
    @Req() request: FastifyRequest,
  ): Promise<OperatorOrgBilling> {
    return await this.billing.load(orgId, String(request.id));
  }

  /** Switches how an organisation pays. Billing staff and above, with a reason, audited. */
  @Put("orgs/:orgId/billing")
  @HttpCode(204)
  @RequireStaff(StaffRole.Billing)
  async setBilling(
    @Param("orgId") orgId: string,
    @Body(new ZodValidationPipe(setBillingModeSchema)) body: SetBillingMode,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.billing.setMode(orgId, body, operatorOf(request), String(request.id));
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
