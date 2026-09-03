import { createValkeyClient, type ValkeyClient } from "@idenzy/cache/connection/client";
import { RevocationSet } from "@idenzy/cache/revocation-set";
import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
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
 * Valkey and the revocation set (PROJECT.md 8.2, ADR-0009).
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
    ValkeyLifecycle,
  ],
  exports: [VALKEY, RevocationSet],
})
export class CacheModule {}
