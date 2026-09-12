import { AppConfig } from "@idenzy/config/app-config";
import { Clock, SystemClock } from "@idenzy/core/time/clock";
import { Global, Module } from "@nestjs/common";

/** Configuration and the clock, global because nearly everything takes one. */
@Global()
@Module({
  providers: [
    { provide: AppConfig, useFactory: () => AppConfig.fromEnvironment() },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [AppConfig, Clock],
})
export class ConfigModule {}
