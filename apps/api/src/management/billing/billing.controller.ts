import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type AutoTopUp,
  autoTopUpSchema,
  type HostedCheckout,
  type InvoiceDetail,
  type InvoiceList,
  type SpendAlert,
  type StartTopUp,
  spendAlertSchema,
  startTopUpSchema,
  type Wallet,
} from "@idenzy/protocol/schemas/billing";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { actorMemberId, orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { BillingService } from "./billing-service.js";

/**
 * The organisation's money (PROJECT.md 5.1, ADR-0011).
 *
 * **Reading is admin and writing is owner**, which is stricter than the rest of the panel
 * and deliberately so. A developer can create an API key and read every user; none of that
 * spends money, and the matrix on the members screen puts billing where an organisation
 * would expect to find it. Anything that can move money — a charge, a card, the automatic
 * rule — is the owner's, because it is the owner whose card it is.
 *
 * No route here takes a card number and none ever will. Adding credit answers with a URL
 * to leave for, because the provider's hosted page is the only place a card is typed, and
 * that is what keeps this service out of PCI scope.
 */
@Controller("v1/orgs/:orgId/billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequireRole(MemberRole.Admin)
  async wallet(@Req() request: FastifyRequest): Promise<Wallet> {
    return await this.billing.wallet(orgContextFrom(request));
  }

  @Post("top-ups")
  @HttpCode(200)
  @RequireRole(MemberRole.Owner)
  async startTopUp(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(startTopUpSchema)) body: StartTopUp,
  ): Promise<HostedCheckout> {
    return await this.billing.startTopUp(
      orgContextFrom(request),
      body.amountCents,
      actorMemberId(request),
    );
  }

  /** A page that saves a card and charges nothing, for a rule set up before there is spend. */
  @Post("methods/setup")
  @HttpCode(200)
  @RequireRole(MemberRole.Owner)
  async startCardSetup(@Req() request: FastifyRequest): Promise<HostedCheckout> {
    return await this.billing.startCardSetup(orgContextFrom(request));
  }

  @Post("methods/:methodId/default")
  @HttpCode(204)
  @RequireRole(MemberRole.Owner)
  async setDefault(
    @Req() request: FastifyRequest,
    @Param("methodId") methodId: string,
  ): Promise<void> {
    await this.billing.setDefaultMethod(orgContextFrom(request), methodId);
  }

  @Delete("methods/:methodId")
  @HttpCode(204)
  @RequireRole(MemberRole.Owner)
  async removeMethod(
    @Req() request: FastifyRequest,
    @Param("methodId") methodId: string,
  ): Promise<void> {
    await this.billing.removeMethod(orgContextFrom(request), methodId);
  }

  @Put("auto-top-up")
  @HttpCode(204)
  @RequireRole(MemberRole.Owner)
  async setAutoTopUp(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(autoTopUpSchema)) body: AutoTopUp,
  ): Promise<void> {
    await this.billing.setAutoTopUp(orgContextFrom(request), body, actorMemberId(request));
  }

  @Put("spend-alert")
  @HttpCode(204)
  @RequireRole(MemberRole.Owner)
  async setSpendAlert(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(spendAlertSchema)) body: SpendAlert,
  ): Promise<void> {
    await this.billing.setSpendAlert(orgContextFrom(request), body, actorMemberId(request));
  }

  @Get("invoices")
  @RequireRole(MemberRole.Admin)
  async invoices(@Req() request: FastifyRequest): Promise<InvoiceList> {
    return await this.billing.invoices(orgContextFrom(request));
  }

  @Get("invoices/:invoiceId")
  @RequireRole(MemberRole.Admin)
  async invoice(
    @Req() request: FastifyRequest,
    @Param("invoiceId") invoiceId: string,
  ): Promise<InvoiceDetail> {
    return await this.billing.invoice(orgContextFrom(request), invoiceId);
  }
}
