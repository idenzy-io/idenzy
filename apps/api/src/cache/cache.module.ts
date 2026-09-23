import { AutoTopUpRuleCache } from "@idenzy/cache/auto-top-up-rule-cache";
import { createValkeyClient, type ValkeyClient } from "@idenzy/cache/connection/client";
import { DueSet } from "@idenzy/cache/due-set";
import { LiveBalanceCache } from "@idenzy/cache/live-balance-cache";
import { LiveUsageSketches } from "@idenzy/cache/live-usage-sketches";
import { RateLimitStrategy } from "@idenzy/cache/rate-limit-strategy";
import { RevocationSet } from "@idenzy/cache/revocation-set";
import { SlidingWindowStrategy } from "@idenzy/cache/sliding-window-strategy";
import {
  AUTO_TOP_UP_DUE_KEY,
  DRAWDOWN_DUE_KEY,
  ValkeyBillingSignals,
} from "@idenzy/cache/valkey-billing-signals";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import { BillingSignals } from "@idenzy/domain/ports/billing-signals";
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";

/** Injection token for the raw client. Only the things in this module take it. */
export const VALKEY = "VALKEY";

/**
 * How much longer than a token's own lifetime an entry has to be kept.
 *
 * A verifier tolerates a little clock skew on `exp`, so a token can be accepted slightly
 * after we would call it expired. Retaining for that much longer than the lifetime means
 * the set still covers a token somebody else's clock thinks is alive.
 */
export const REVOCATION_SKEW_SECONDS = 60;

/**
 * Closes the connection when the application does.
 *
 * A class for one hook, because Nest calls lifecycle methods on provider instances and a
 * client built by a factory has none. Without it a stopped app keeps a socket open and
 * the process outlives its own shutdown.
 */
@Injectable()
export class ValkeyLifecycle implements OnApplicationShutdown {
  constructor(@Inject(VALKEY) private readonly client: ValkeyClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}

/**
 * Valkey, the revocation set, and the billing signals (PROJECT.md 8.2, ADR-0009, ADR-0017).
 *
 * The set is written to and published; it is not read on the request path. `SessionGuard`
 * reads the session row, so revocation is already immediate for our own endpoints, and
 * putting a cache in front of a query the route makes anyway would buy nothing. What the
 * set is for is the customer's verifier, which is offline by design and cannot ask us
 * anything without giving up the property it exists for.
 */
@Global()
@Module({
  providers: [
    {
      provide: VALKEY,
      inject: [AppConfig, Logger],
      useFactory: (config: AppConfig, logger: Logger): ValkeyClient =>
        createValkeyClient({
          url: config.get("VALKEY_URL"),
          onError: (error) => {
            logger.error("valkey connection error", {
              component: "valkey",
              outcome: "unavailable",
              errorCode: error.name,
            });
          },
        }),
    },
    {
      provide: RevocationSet,
      inject: [VALKEY, Clock, AppConfig],
      useFactory: (valkey: ValkeyClient, clock: Clock, config: AppConfig): RevocationSet =>
        new RevocationSet(
          valkey,
          clock,
          config.get("ACCESS_TOKEN_TTL_SECONDS") + REVOCATION_SKEW_SECONDS,
        ),
    },
    {
      // The one rate limiter, shared. Two strategies over one Valkey would be two key
      // namespaces for the same job, and the base class fixes that namespace precisely
      // so a second one cannot appear by accident.
      provide: RateLimitStrategy,
      inject: [VALKEY, Clock],
      useFactory: (valkey: ValkeyClient, clock: Clock): RateLimitStrategy =>
        new SlidingWindowStrategy(valkey, clock),
    },
    {
      // Hints to the billing worker (ADR-0017). Sent after the change they describe has
      // committed, and never able to fail the request that sends them.
      provide: BillingSignals,
      inject: [VALKEY, Clock, Logger],
      useFactory: (valkey: ValkeyClient, clock: Clock, logger: Logger): BillingSignals =>
        new ValkeyBillingSignals(
          new DueSet(valkey, DRAWDOWN_DUE_KEY),
          new DueSet(valkey, AUTO_TOP_UP_DUE_KEY),
          new AutoTopUpRuleCache(valkey),
          clock,
          (signal, cause) => {
            logger.warn("billing signal not sent", {
              component: "billing",
              outcome: signal,
              errorName: cause instanceof Error ? cause.name : "unknown",
            });
          },
        ),
    },
    {
      // Each instance's view of every project's month, for the live balance (ADR-0017).
      provide: LiveUsageSketches,
      inject: [VALKEY],
      useFactory: (valkey: ValkeyClient): LiveUsageSketches => new LiveUsageSketches(valkey),
    },
    {
      // The live balance the billing worker computes, read on a visit (ADR-0017).
      provide: LiveBalanceCache,
      inject: [VALKEY],
      useFactory: (valkey: ValkeyClient): LiveBalanceCache => new LiveBalanceCache(valkey),
    },
    ValkeyLifecycle,
  ],
  exports: [
    VALKEY,
    RevocationSet,
    RateLimitStrategy,
    BillingSignals,
    LiveUsageSketches,
    LiveBalanceCache,
  ],
})
export class CacheModule {}
