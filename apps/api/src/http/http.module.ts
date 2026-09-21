import { Global, Module } from "@nestjs/common";
import { CorsPolicy } from "./cors-policy.js";

/**
 * The HTTP edge: the pieces that sit outside Nest's guard chain (PROJECT.md 9.3).
 *
 * Global because `main.ts` resolves the policy to bind it to Fastify before listening, and
 * because the cross-site guards read the same allowlist it does.
 */
@Global()
@Module({
  providers: [CorsPolicy],
  exports: [CorsPolicy],
})
export class HttpModule {}
