import { AppConfig } from "@idenzy/config/app-config";
import { Clock, SystemClock } from "@idenzy/core/time/clock";
import { SecretManagerSource } from "@idenzy/providers-gcp/secret-manager-source";
import { Global, Module } from "@nestjs/common";
import { ProjectSettingsReader } from "./project-settings-reader.js";

/**
 * Configuration and time (PROJECT.md 9.2).
 *
 * Both are process-wide ports that everything else assumes exists, and both are parsed
 * or bound once at boot. A bad environment fails here rather than as a confusing 500 an
 * hour later.
 */
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
    // Per-project configuration, which is a read rather than a boot-time parse: it changes
    // while the process runs, because a customer changes it on the dashboard.
    ProjectSettingsReader,
  ],
  exports: [AppConfig, Clock, ProjectSettingsReader],
})
export class ConfigModule {}
