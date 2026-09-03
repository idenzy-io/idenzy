import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import {
  EmailProvider,
  type SuppressionList,
  type UsageMeter,
} from "@idenzy/domain/ports/email-provider";
import { LoggingEmailProvider } from "@idenzy/providers-email/logging-email-provider";
import { TemplateRenderer, TemplateStore } from "@idenzy/templating/renderer";
import { Global, Module } from "@nestjs/common";
import { DatabaseSuppressionList } from "./database-suppression-list.js";
import { DatabaseTemplateStore } from "./database-template-store.js";
import { DatabaseUsageMeter } from "./database-usage-meter.js";
import { Mailer } from "./mailer.js";

/**
 * Outbound email (PROJECT.md 11).
 *
 * The one place that knows which transport is in use. Today that is the development
 * logger, which refuses to construct outside development, so a deployed environment
 * fails at boot rather than silently swallowing every sign-in code. A real adapter is a
 * change to this factory and nothing else.
 *
 * Global, because a flow that could be constructed without a mailer would be a flow that
 * issues a challenge nobody can answer.
 */
@Global()
@Module({
  providers: [
    DatabaseSuppressionList,
    DatabaseUsageMeter,
    { provide: TemplateStore, useClass: DatabaseTemplateStore },
    {
      provide: TemplateRenderer,
      inject: [TemplateStore],
      useFactory: (store: TemplateStore) => new TemplateRenderer(store),
    },
    {
      provide: EmailProvider,
      inject: [DatabaseSuppressionList, DatabaseUsageMeter, Logger, AppConfig],
      useFactory: (
        suppression: SuppressionList,
        meter: UsageMeter,
        logger: Logger,
        config: AppConfig,
      ) => new LoggingEmailProvider(suppression, meter, logger, config.get("IDENZY_ENV")),
    },
    Mailer,
  ],
  exports: [Mailer, EmailProvider, TemplateRenderer],
})
export class DeliveryModule {}
