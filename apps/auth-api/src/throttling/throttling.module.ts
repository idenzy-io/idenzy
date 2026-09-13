import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ClientIpResolver } from "./client-ip.js";
import { RateLimitGuard } from "./rate-limit.guard.js";

/**
 * Application rate limiting (PROJECT.md 4.9).
 *
 * The edge half of §4.9 is Cloud Armor and is not built, because nothing is deployed. This
 * is the half that runs anywhere, and it is the half that can see a project and an account
 * — a WAF rate-limits an address against a path and cannot know that a thousand addresses
 * are all naming one person's email.
 *
 * Imported after `TenancyModule` and before `SessionModule`, and the order is the design.
 * After tenant resolution, so a bucket can be scoped to the project it is spent against;
 * before the session guard, so a flood of unauthenticated requests is refused without
 * costing a session lookup each.
 */
@Global()
@Module({
  providers: [ClientIpResolver, { provide: APP_GUARD, useClass: RateLimitGuard }],
  exports: [ClientIpResolver],
})
export class ThrottlingModule {}
