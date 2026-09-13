import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { EmailProvider } from "@idenzy/domain/ports/email-provider";
import type { FraudGuard, SpendCap } from "@idenzy/domain/ports/sms-provider";
import { SmsProvider } from "@idenzy/domain/ports/sms-provider";
import { LoggingSmsProvider } from "@idenzy/providers-sms/logging-sms-provider";
import { MetadataPhoneGeography } from "@idenzy/providers-sms/metadata-phone-geography";
import { ProviderRouter } from "@idenzy/providers-sms/provider-router";
import { TemplateRenderer, TemplateStore } from "@idenzy/templating/renderer";
import { NoStoredSmsTemplates, SmsRenderer } from "@idenzy/templating/sms-renderer";
import { Global, Module } from "@nestjs/common";
import { DatabaseSpendCap } from "./database-spend-cap.js";
import { DatabaseSuppressionList } from "./database-suppression-list.js";
import { DatabaseTemplateStore } from "./database-template-store.js";
import { DatabaseUsageMeter } from "./database-usage-meter.js";
import { ATTESTATION_VERIFIER, PHONE_GEOGRAPHY } from "./delivery-tokens.js";
import { emailProviderFor } from "./email-transport.js";
import { Mailer } from "./mailer.js";
import { RedirectTargets } from "./redirect-targets.js";
import { SmsFraudGuard } from "./sms-fraud-guard.js";
import { Texter } from "./texter.js";
import { UnconfiguredAttestation } from "./unconfigured-attestation.js";

/**
 * Outbound email and SMS (PROJECT.md 11).
 *
 * The one place that knows which transports are in use. Email has a real adapter now and
 * SMS does not: `emailProviderFor` picks SES when it is configured and the development
 * logger otherwise, and that logger refuses to construct outside development, so a
 * deployment that forgot to configure a transport fails at boot rather than silently
 * swallowing every sign-in code. The SMS half is still the logger alone, and a Twilio or
 * AWS End User Messaging adapter is a change to this file and nothing else.
 *
 * The SMS half wires more than a transport, and that is the design rather than a
 * complication: the fraud guard and the spend cap are constructor arguments of
 * `SmsProvider` itself, so there is no way to assemble a provider that skips them.
 *
 * Global, because a flow that could be constructed without a mailer would be a flow that
 * issues a challenge nobody can answer.
 */
@Global()
@Module({
  providers: [
    DatabaseSuppressionList,
    DatabaseUsageMeter,
    DatabaseSpendCap,
    SmsFraudGuard,
    { provide: PHONE_GEOGRAPHY, useClass: MetadataPhoneGeography },
    { provide: ATTESTATION_VERIFIER, useClass: UnconfiguredAttestation },
    { provide: TemplateStore, useClass: DatabaseTemplateStore },
    {
      provide: TemplateRenderer,
      inject: [TemplateStore],
      useFactory: (store: TemplateStore) => new TemplateRenderer(store),
    },
    {
      // No store yet: customer-authored SMS copy arrives with the studio, and until then
      // every project sends the built-in bodies.
      provide: SmsRenderer,
      useFactory: () => new SmsRenderer(new NoStoredSmsTemplates()),
    },
    {
      provide: EmailProvider,
      inject: [DatabaseSuppressionList, DatabaseUsageMeter, Logger, AppConfig, Clock],
      useFactory: emailProviderFor,
    },
    {
      provide: SmsProvider,
      inject: [SmsFraudGuard, DatabaseSpendCap, Logger, AppConfig],
      useFactory: (fraudGuard: FraudGuard, spendCap: SpendCap, logger: Logger, config: AppConfig) =>
        new LoggingSmsProvider(fraudGuard, spendCap, logger, config.get("IDENZY_ENV")),
    },
    {
      // One provider, so the table is one default rule. The per-country routing this
      // class exists for needs a second adapter to route to, and adding one is a change
      // to this list rather than to the router.
      provide: ProviderRouter,
      inject: [SmsProvider, Clock],
      useFactory: (provider: SmsProvider, clock: Clock) =>
        new ProviderRouter([provider], [{ country: "*", providers: [provider.id] }], clock),
    },
    Mailer,
    Texter,
    RedirectTargets,
  ],
  exports: [Mailer, Texter, RedirectTargets, EmailProvider, SmsProvider, TemplateRenderer],
})
export class DeliveryModule {}
