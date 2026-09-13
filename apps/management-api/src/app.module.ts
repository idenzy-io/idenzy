import { Module } from "@nestjs/common";
import { ApiKeysModule } from "./api-keys/api-keys.module.js";
import { ClaimsModule } from "./claims/claims.module.js";
import { ConfigModule } from "./config/config.module.js";
import { DomainsModule } from "./domains/domains.module.js";
import { HealthController } from "./health.controller.js";
import { HttpModule } from "./http/http.module.js";
import { MeModule } from "./me/me.module.js";
import { MembersModule } from "./members/members.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { OnboardingModule } from "./onboarding/onboarding.module.js";
import { OrgsModule } from "./orgs/orgs.module.js";
import { OriginsModule } from "./origins/origins.module.js";
import { PersistenceModule } from "./persistence/persistence.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { ProvidersModule } from "./providers/providers.module.js";
import { RetentionModule } from "./retention/retention.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";
import { UsageModule } from "./usage/usage.module.js";
import { UsersModule } from "./users/users.module.js";
import { WebhooksModule } from "./webhooks/webhooks.module.js";

/**
 * Dashboard, management API and billing control plane (PROJECT.md 9.1).
 *
 * A separate deployment from auth-api on purpose: a dashboard incident must not be able
 * to degrade sign-in. It costs about $25/mo, which is cheap for that isolation.
 *
 * Global modules first, in dependency order, then feature modules — the same shape
 * auth-api's composition root has. `TenancyModule` registers the guard globally, so a new
 * controller is authenticated by default and a route opts out by saying nothing rather
 * than by remembering to add a decorator.
 */
@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    PersistenceModule,
    HttpModule,
    TenancyModule,
    MeModule,
    OnboardingModule,
    OrgsModule,
    ProjectsModule,
    ApiKeysModule,
    DomainsModule,
    OriginsModule,
    ClaimsModule,
    MembersModule,
    ProvidersModule,
    SessionsModule,
    RetentionModule,
    SettingsModule,
    UsageModule,
    UsersModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
