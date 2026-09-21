import { PaymentProviderEventRepository } from "@idenzy/persistence/repository/payment-provider-event-repository";
import { Module } from "@nestjs/common";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE } from "../../persistence/persistence.module.js";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing-service.js";
import { PaymentWebhookController } from "./payment-webhook.controller.js";
import { PaymentWebhookService } from "./payment-webhook-service.js";

/**
 * The organisation's money, and the one route on this service a browser never calls.
 *
 * `PaymentProviderEventRepository` takes the raw handle rather than a `UnitOfWork`, and
 * that is not an oversight: a webhook arrives with no tenant bound, and the idempotency
 * table it writes is keyed by the provider's event id rather than by an organisation.
 * Scoping it would mean knowing whose event it is before being allowed to record that we
 * have seen it, which is backwards.
 */
@Module({
  controllers: [BillingController, PaymentWebhookController],
  providers: [
    BillingService,
    PaymentWebhookService,
    {
      provide: PaymentProviderEventRepository,
      inject: [DATABASE],
      useFactory: (db: NodePgDatabase) => new PaymentProviderEventRepository(db),
    },
  ],
})
export class BillingModule {}
