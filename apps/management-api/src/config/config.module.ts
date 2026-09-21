import { AppConfig } from "@idenzy/config/app-config";
import { Clock, SystemClock } from "@idenzy/core/time/clock";
import { SecretManagerSource } from "@idenzy/providers-gcp/secret-manager-source";
import { Global, Module } from "@nestjs/common";

/** Configuration and the clock, global because nearly everything takes one. */
@Global()
@Module({
  providers: [
    {
      provide: AppConfig,
      // Development reads the environment; anywhere else it holds `secret://` references and this
      // resolves them through Secret Manager before the schema ever sees them (PROJECT.md 6.2).
      useFactory: () => AppConfig.bootstrap((projectId) => new SecretManagerSource(projectId)),
    },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [AppConfig, Clock],
})
export class ConfigModule {}
