import { AppConfig } from "@idenzy/config/app-config";
import { Clock, SystemClock } from "@idenzy/core/time/clock";
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
    { provide: AppConfig, useFactory: () => AppConfig.fromEnvironment() },
    { provide: Clock, useClass: SystemClock },
    // Per-project configuration, which is a read rather than a boot-time parse: it changes
    // while the process runs, because a customer changes it on the dashboard.
    ProjectSettingsReader,
  ],
  exports: [AppConfig, Clock, ProjectSettingsReader],
})
export class ConfigModule {}
