import { Global, Module } from "@nestjs/common";
import { CorsPolicy } from "./cors-policy.js";

/** The one piece of HTTP policy this service has. Global so `main.ts` can reach it. */
@Global()
@Module({ providers: [CorsPolicy], exports: [CorsPolicy] })
export class HttpModule {}
