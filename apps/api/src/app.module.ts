import { Module } from "@nestjs/common";
import { AccountModule } from "./account/account.module.js";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { AnonymousModule } from "./anonymous/anonymous.module.js";
import { CacheModule } from "./cache/cache.module.js";
import { ClaimsModule } from "./claims/claims.module.js";
import { ConfigModule } from "./config/config.module.js";
import { CryptoModule } from "./crypto/crypto.module.js";
import { DeliveryModule } from "./delivery/delivery.module.js";
import { ErasureModule } from "./erasure/erasure.module.js";
import { FlowsModule } from "./flows/flows.module.js";
import { HealthController } from "./health/health.controller.js";
import { HttpModule } from "./http/http.module.js";
import { MagicLinkModule } from "./magic-link/magic-link.module.js";
import { ApiKeysModule } from "./management/api-keys/api-keys.module.js";
import { AuditModule } from "./management/audit/audit.module.js";
import { BillingModule } from "./management/billing/billing.module.js";
import { PaymentProviderModule } from "./management/billing/payment-provider.module.js";
import { DashboardClaimsModule } from "./management/claims/claims.module.js";
import { DomainsModule } from "./management/domains/domains.module.js";
import { MeModule } from "./management/me/me.module.js";
import { MembersModule } from "./management/members/members.module.js";
import { OnboardingModule } from "./management/onboarding/onboarding.module.js";
import { OrgsModule } from "./management/orgs/orgs.module.js";
import { OriginsModule } from "./management/origins/origins.module.js";
import { RelyingPartyModule } from "./management/passkeys/relying-party.module.js";
import { ProjectsModule } from "./management/projects/projects.module.js";
import { ProvidersModule } from "./management/providers/providers.module.js";
import { RetentionModule } from "./management/retention/retention.module.js";
import { SessionsModule } from "./management/sessions/sessions.module.js";
import { SettingsModule } from "./management/settings/settings.module.js";
import { DashboardTenancyModule } from "./management/tenancy/tenancy.module.js";
import { DashboardUsageModule } from "./management/usage/usage.module.js";
import { UsersModule } from "./management/users/users.module.js";
import { WebhooksModule } from "./management/webhooks/webhooks.module.js";
import { MfaModule } from "./mfa/mfa.module.js";
import { OAuthModule } from "./oauth/oauth.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { OperatorModule } from "./operator/operator.module.js";
import { OtpModule } from "./otp/otp.module.js";
import { PasskeyModule } from "./passkey/passkey.module.js";
import { PasswordModule } from "./password/password.module.js";
import { PersistenceModule } from "./persistence/persistence.module.js";
import { RevocationController } from "./revocation/revocation.controller.js";
import { SessionModule } from "./session/session.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";
import { ThrottlingModule } from "./throttling/throttling.module.js";
import { UsageModule } from "./usage/usage.module.js";
import { ProjectKeysController } from "./well-known/project-keys.controller.js";

/**
 * Composition root (PROJECT.md 9.2).
 *
 * Global modules first, in dependency order, then feature modules. This file knows which
 * implementation backs each port and nothing else knows; swapping the local token issuer
 * for the KMS one is a change in CryptoModule and nowhere else.
 *
 * **Two surfaces in one container.** Everything under `management/` was `apps/management-api`
 * until the two services were merged: the public authentication API a customer's end users
 * reach, and the dashboard API our own panel reaches. They keep separate module trees rather
 * than being blended, because they authenticate differently and trust different origins, and
 * `http/surface.ts` is the one place that says which routes are which.
 *
 * Three dashboard modules carry a `Dashboard` prefix — claims, tenancy and usage — because an
 * auth-side module already owned the plain name and two different things called `UsageModule`
 * in one file is how the wrong one gets imported.
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
    // After tenant resolution so a limit can be scoped to a project, and before
    // SessionModule so a flood is refused before it costs a session lookup.
    ThrottlingModule,
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
    ErasureModule,

    // The dashboard surface. `DashboardTenancyModule` registers `MembershipGuard`, which is
    // opt-in per route on `@RequireSignIn`/`@RequireRole` and so is inert on every auth route.
    DashboardTenancyModule,
    MeModule,
    OnboardingModule,
    OrgsModule,
    ProjectsModule,
    ApiKeysModule,
    AuditModule,
    PaymentProviderModule,
    BillingModule,
    DomainsModule,
    OriginsModule,
    DashboardClaimsModule,
    MembersModule,
    ProvidersModule,
    RelyingPartyModule,
    SessionsModule,
    RetentionModule,
    SettingsModule,
    DashboardUsageModule,
    UsersModule,
    WebhooksModule,

    // The operator surface (ADR-0018). `StaffGuard` is opt-in on `@RequireStaff`, so it is inert
    // on every other route, and it verifies against the operator project rather than the
    // dashboard's, so neither audience accepts the other's tokens.
    OperatorModule,
  ],
  controllers: [HealthController, ProjectKeysController, RevocationController],
})
export class AppModule {}
