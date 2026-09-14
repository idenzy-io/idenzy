import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { BillingSettingsRow } from "@idenzy/persistence/repository/billing-settings-repository";
import type { CreditGrantRow } from "@idenzy/persistence/repository/credit-grant-repository";
import type { InvoiceLineRow, InvoiceRow } from "@idenzy/persistence/repository/invoice-repository";
import type { PaymentMethodRow } from "@idenzy/persistence/repository/payment-method-repository";
import type { TopUpRow } from "@idenzy/persistence/repository/top-up-repository";
import type {
  AutoTopUp,
  CreditGrant,
  Invoice,
  InvoiceLine,
  PaymentMethod,
  SpendAlert,
  TopUp,
} from "@idenzy/protocol/schemas/billing";
import { IdPrefix } from "@idenzy/protocol/schemas/common";

/**
 * Rows as the wire says them.
 *
 * Every id goes out in its public form, and the provider's own never does: `stripe`'s
 * `pm_…` and `pi_…` identify objects in an account the customer has no access to, and
 * publishing them would be naming a system they cannot look anything up in. What the panel
 * addresses is our row.
 */
export const present = {
  grant(row: CreditGrantRow): CreditGrant {
    return {
      id: PublicId.encode(IdPrefix.CreditGrant, row.id).value,
      kind: row.kind,
      amountCents: row.amountCents,
      remainingCents: row.remainingCents,
      currency: row.currency,
      grantedAt: row.grantedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      note: row.note,
    };
  },

  /**
   * A card, with who added it resolved to a person.
   *
   * `added_by` holds an `org_members.id`, which is not a name and not the `users.id`
   * either — the two are different uuids for the same person, which is the mistake the
   * invitations list already made once. Null where that member has left, which is a normal
   * row rather than an error.
   */
  method(row: PaymentMethodRow, members: ReadonlyMap<string, string>): PaymentMethod {
    return {
      id: PublicId.encode(IdPrefix.PaymentMethod, row.id).value,
      brand: row.brand,
      last4: row.last4,
      expiryMonth: row.expiryMonth,
      expiryYear: row.expiryYear,
      isDefault: row.isDefault,
      addedBy: row.addedBy === null ? null : (members.get(row.addedBy) ?? null),
      addedAt: row.createdAt.toISOString(),
    };
  },

  topUp(row: TopUpRow): TopUp {
    return {
      id: PublicId.encode(IdPrefix.TopUp, row.id).value,
      amountCents: row.amountCents,
      currency: row.currency,
      state: row.state,
      trigger: row.trigger,
      cardBrand: row.cardBrand,
      cardLast4: row.cardLast4,
      failureCode: row.failureCode,
      createdAt: row.createdAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
    };
  },

  invoice(row: InvoiceRow): Invoice {
    return {
      id: PublicId.encode(IdPrefix.Invoice, row.id).value,
      number: row.number,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      issuedAt: row.issuedAt.toISOString(),
      totalCents: row.totalCents,
      currency: row.currency,
      status: row.status,
      pdfUri: row.pdfUri,
    };
  },

  invoiceLine(row: InvoiceLineRow): InvoiceLine {
    return {
      projectId:
        row.projectId === null ? null : PublicId.encode(IdPrefix.Project, row.projectId).value,
      item: row.item,
      quantity: row.quantity,
      unitRateMillicents: row.unitRateMillicents,
      totalCents: row.totalCents,
    };
  },

  autoTopUp(settings: BillingSettingsRow): AutoTopUp {
    return {
      enabled: settings.autoTopUp.enabled,
      thresholdCents: settings.autoTopUp.thresholdCents,
      amountCents: settings.autoTopUp.amountCents,
      methodId:
        settings.autoTopUp.methodId === null
          ? null
          : PublicId.encode(IdPrefix.PaymentMethod, settings.autoTopUp.methodId).value,
    };
  },

  spendAlert(settings: BillingSettingsRow): SpendAlert {
    return {
      enabled: settings.spendAlert.enabled,
      thresholdCents: settings.spendAlert.thresholdCents,
    };
  },
};
