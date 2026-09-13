import { Module } from "@nestjs/common";
import { AccountModule } from "./account/account.module.js";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { AnonymousModule } from "./anonymous/anonymous.module.js";
import { CacheModule } from "./cache/cache.module.js";
import { ClaimsModule } from "./claims/claims.module.js";
import { ConfigModule } from "./config/config.module.js";
import { CryptoModule } from "./crypto/crypto.module.js";
import { DeliveryModule } from "./delivery/delivery.module.js";
import { FlowsModule } from "./flows/flows.module.js";
import { HealthController } from "./health/health.controller.js";
import { HttpModule } from "./http/http.module.js";
import { MagicLinkModule } from "./magic-link/magic-link.module.js";
import { MfaModule } from "./mfa/mfa.module.js";
import { OAuthModule } from "./oauth/oauth.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { OtpModule } from "./otp/otp.module.js";
import { PasskeyModule } from "./passkey/passkey.module.js";
import { PasswordModule } from "./password/password.module.js";
import { PersistenceModule } from "./persistence/persistence.module.js";
import { RevocationController } from "./revocation/revocation.controller.js";
import { SessionModule } from "./session/session.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";
import { UsageModule } from "./usage/usage.module.js";
import { WellKnownController } from "./well-known/well-known.controller.js";

/**
 * Composition root (PROJECT.md 9.2).
 *
 * Global modules first, in dependency order, then feature modules. This file knows which
 * implementation backs each port and nothing else knows; swapping the local token issuer
 * for the KMS one is a change in CryptoModule and nowhere else.
 */
@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    PersistenceModule,
    CacheModule,
    CryptoModule,
    ClaimsModule,
    HttpModule,
    FlowsModule,
    TenancyModule,
    AnalyticsModule,
    UsageModule,
    DeliveryModule,
    SessionModule,
    PasswordModule,
    OtpModule,
    MagicLinkModule,
    PasskeyModule,
    OAuthModule,
    MfaModule,
    AccountModule,
    AnonymousModule,
  ],
  controllers: [HealthController, WellKnownController, RevocationController],
})
export class AppModule {}
