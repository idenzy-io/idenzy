import { ResourceNotFoundError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { BillingSignals } from "@idenzy/domain/ports/billing-signals";
import { BillingSettingsRepository } from "@idenzy/persistence/repository/billing-settings-repository";
import { InvoiceRepository } from "@idenzy/persistence/repository/invoice-repository";
import { OperatorOrgReader } from "@idenzy/persistence/repository/operator-org-reader";
import { OperatorActionLog } from "@idenzy/persistence/repository/staff-reader";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { OperatorAction } from "@idenzy/protocol/enums/staff";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { OperatorOrgBilling, SetBillingMode } from "@idenzy/protocol/schemas/operator";
import { Injectable } from "@nestjs/common";
import { OrgBalanceReader } from "../management/billing/org-balance-reader.js";
import { present } from "../management/billing/present.js";
import type { OperatorPrincipal } from "./staff.guard.js";

/**
 * How an operator sees and changes the way an organisation pays (ADR-0019).
 *
 * **Every change carries its reason, in the same transaction.** The settings row and the
 * `operator_actions` row commit together or not at all, so there is no switch to invoicing that
 * the audit trail does not name a person and a reason for — and no row claiming a switch that did
 * not happen.
 */
@Injectable()
export class OperatorBillingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly orgs: OperatorOrgReader,
    private readonly balances: OrgBalanceReader,
    private readonly signals: BillingSignals,
  ) {}

  async load(orgPublicId: string, requestId: string): Promise<OperatorOrgBilling> {
    const context = this.contextOf(orgPublicId, requestId);
    const org = await this.orgs.byId(context.orgId);
    if (org === null) throw new ResourceNotFoundError({ detail: { orgId: orgPublicId } });
    const found = await this.uow.transaction(async (tx) => ({
      settings: await new BillingSettingsRepository(tx, context).current(),
      invoices: await new InvoiceRepository(tx, context).list(24),
    }));

    return {
      org: { id: orgPublicId, name: org.name, createdAt: org.createdAt.toISOString() },
      mode: found.settings.mode,
      invoiceTermsDays: found.settings.invoiceTermsDays,
      invoiceEmail: found.settings.invoiceEmail,
      balance: await this.balances.read(context),
      invoices: found.invoices.map(present.invoice),
    };
  }

  async setMode(
    orgPublicId: string,
    change: SetBillingMode,
    operator: OperatorPrincipal,
    requestId: string,
  ): Promise<void> {
    const context = this.contextOf(orgPublicId, requestId);
    if ((await this.orgs.byId(context.orgId)) === null) {
      throw new ResourceNotFoundError({ detail: { orgId: orgPublicId } });
    }
    await this.uow.transaction(async (tx) => {
      const settings = new BillingSettingsRepository(tx, context);
      const before = await settings.current();
      await settings.setBillingMode(
        change.mode,
        change.invoiceTermsDays,
        change.invoiceEmail?.toLowerCase() ?? null,
        null,
      );
      await new OperatorActionLog(tx).record({
        staffId: operator.staffId,
        action: OperatorAction.SetBillingMode,
        orgId: context.orgId,
        detail: {
          from: {
            mode: before.mode,
            invoiceTermsDays: before.invoiceTermsDays,
            invoiceEmail: before.invoiceEmail,
          },
          to: {
            mode: change.mode,
            invoiceTermsDays: change.invoiceTermsDays,
            invoiceEmail: change.invoiceEmail?.toLowerCase() ?? null,
          },
        },
        reason: change.reason,
      });
    });

    // The worker caches whether the rule is armed and what the ledger said; both depend on the
    // mode now, so both are dropped and the organisation looked at again within a tick.
    await this.signals.ruleChanged(context.orgId);
    await this.signals.walletMoved(context.orgId);
  }

  private contextOf(orgPublicId: string, requestId: string): OrgContext {
    return new OrgContext(PublicId.parse(IdPrefix.Org, orgPublicId).uuid, requestId, "system");
  }
}
