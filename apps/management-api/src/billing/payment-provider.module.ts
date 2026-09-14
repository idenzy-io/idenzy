import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { PaymentProvider } from "@idenzy/domain/ports/payment-provider";
import { StripePaymentProvider } from "@idenzy/providers-payment/stripe-payment-provider";
import { type StripeSettings, stripeSettingsFrom } from "@idenzy/providers-payment/stripe-settings";
import { Global, Module } from "@nestjs/common";

/** Injection token for the settings, so a service can ask where to send a browser back to. */
export const CHECKOUT_URLS = Symbol("idenzy:checkout-urls");

export interface CheckoutUrls {
  readonly successUrl: string;
  readonly cancelUrl: string;
}

/**
 * The payment provider, where one is configured (PROJECT.md 5.1).
 *
 * **A deployment with no Stripe keys is correct rather than degraded.** The provider
 * resolves to null, the wallet answers with `provider: null`, and the screen says nothing
 * can take a card instead of offering a control that would fail. That is the same shape
 * `NullAnalyticsRecorder` gives the analytics store, with one difference worth stating: a
 * null recorder swallows, and this one is absent, because a top-up that silently did
 * nothing would be worse than one that was never offered.
 *
 * What is not allowed is a partial configuration. `stripeSettingsFrom` throws on three of
 * four, so the process does not start — a deployment missing only the webhook secret would
 * take a customer through a checkout it cannot verify the outcome of, which is money
 * charged and no credit granted.
 */
@Global()
@Module({
  providers: [
    {
      provide: PaymentProvider,
      inject: [AppConfig, Logger],
      useFactory: (config: AppConfig, logger: Logger): PaymentProvider | null => {
        const settings = settingsFrom(config);
        if (settings === null) {
          logger.info("no payment provider configured", {
            component: "billing",
            outcome: "disabled",
          });
          return null;
        }
        return new StripePaymentProvider(settings);
      },
    },
    {
      provide: CHECKOUT_URLS,
      inject: [AppConfig],
      useFactory: (config: AppConfig): CheckoutUrls | null => {
        const settings = settingsFrom(config);
        return settings === null
          ? null
          : { successUrl: settings.successUrl, cancelUrl: settings.cancelUrl };
      },
    },
  ],
  exports: [PaymentProvider, CHECKOUT_URLS],
})
export class PaymentProviderModule {}

function settingsFrom(config: AppConfig): StripeSettings | null {
  return stripeSettingsFrom({
    STRIPE_SECRET_KEY: config.get("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: config.get("STRIPE_WEBHOOK_SECRET"),
    STRIPE_API_VERSION: config.get("STRIPE_API_VERSION"),
    STRIPE_CHECKOUT_SUCCESS_URL: config.get("STRIPE_CHECKOUT_SUCCESS_URL"),
    STRIPE_CHECKOUT_CANCEL_URL: config.get("STRIPE_CHECKOUT_CANCEL_URL"),
  });
}
