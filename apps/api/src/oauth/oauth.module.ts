import { Clock } from "@idenzy/core/time/clock";
import type { OAuthProvider } from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";
import { FetchHttpClient } from "@idenzy/providers-oauth/fetch-http-client";
import { AppleProvider } from "@idenzy/providers-oauth/providers/apple-provider";
import { BitbucketProvider } from "@idenzy/providers-oauth/providers/bitbucket-provider";
import { DiscordProvider } from "@idenzy/providers-oauth/providers/discord-provider";
import { FacebookProvider } from "@idenzy/providers-oauth/providers/facebook-provider";
import { FigmaProvider } from "@idenzy/providers-oauth/providers/figma-provider";
import { GithubProvider } from "@idenzy/providers-oauth/providers/github-provider";
import { GitlabProvider } from "@idenzy/providers-oauth/providers/gitlab-provider";
import { GoogleProvider } from "@idenzy/providers-oauth/providers/google-provider";
import { KakaoProvider } from "@idenzy/providers-oauth/providers/kakao-provider";
import { LineProvider } from "@idenzy/providers-oauth/providers/line-provider";
import { LinkedinProvider } from "@idenzy/providers-oauth/providers/linkedin-provider";
import { MicrosoftProvider } from "@idenzy/providers-oauth/providers/microsoft-provider";
import { NotionProvider } from "@idenzy/providers-oauth/providers/notion-provider";
import { SlackProvider } from "@idenzy/providers-oauth/providers/slack-provider";
import { SpotifyProvider } from "@idenzy/providers-oauth/providers/spotify-provider";
import { TwitchProvider } from "@idenzy/providers-oauth/providers/twitch-provider";
import { XProvider } from "@idenzy/providers-oauth/providers/x-provider";
import { ZoomProvider } from "@idenzy/providers-oauth/providers/zoom-provider";
import { Module } from "@nestjs/common";
import { SessionModule } from "../session/session.module.js";
import { DatabaseOAuthFlowStore } from "./database-oauth-flow-store.js";
import { DatabaseRedirectAllowlist } from "./database-redirect-allowlist.js";
import { IdTokenController } from "./id-token.controller.js";
import { IdTokenFlow } from "./id-token.flow.js";
import { IdTokenNonceService } from "./id-token-nonce-service.js";
import { OAuthController } from "./oauth.controller.js";
import { OAuthCodeFlow } from "./oauth-code.flow.js";
import { OAuthService } from "./oauth-service.js";
import { OAUTH_PROVIDERS } from "./oauth-tokens.js";
import { ProviderRegistry } from "./provider-registry.js";
import { ProviderSignIn } from "./provider-sign-in.js";

/**
 * Social sign-in (PROJECT.md 4.6, 9.2), through the redirect and through a native ID token (4.4).
 *
 * The linking policy is bound here with auto-linking on, which is the default a customer
 * can turn off per project once project settings reach the panel. It is a constructor
 * argument rather than a flag read at the call site, so the rule cannot be applied
 * differently in two places.
 */
@Module({
  imports: [SessionModule],
  controllers: [OAuthController, IdTokenController],
  providers: [
    DatabaseOAuthFlowStore,
    DatabaseRedirectAllowlist,
    {
      // Adding a provider is one line here plus its adapter, which is the whole payoff
      // of the base class: everything else about the flow is already written.
      provide: OAUTH_PROVIDERS,
      inject: [Clock, DatabaseOAuthFlowStore, DatabaseRedirectAllowlist],
      useFactory: (
        clock: Clock,
        flows: DatabaseOAuthFlowStore,
        allowlist: DatabaseRedirectAllowlist,
      ): ReadonlyMap<string, OAuthProvider> => {
        const http = new FetchHttpClient();
        return new Map<string, OAuthProvider>([
          [ProviderId.Google, new GoogleProvider(http, clock, flows, allowlist)],
          [ProviderId.Microsoft, new MicrosoftProvider(http, clock, flows, allowlist)],
          [ProviderId.Github, new GithubProvider(http, clock, flows, allowlist)],
          [ProviderId.Apple, new AppleProvider(http, clock, flows, allowlist)],
          [ProviderId.Facebook, new FacebookProvider(http, clock, flows, allowlist)],
          [ProviderId.Discord, new DiscordProvider(http, clock, flows, allowlist)],
          [ProviderId.Twitch, new TwitchProvider(http, clock, flows, allowlist)],
          [ProviderId.Linkedin, new LinkedinProvider(http, clock, flows, allowlist)],
          [ProviderId.X, new XProvider(http, clock, flows, allowlist)],
          [ProviderId.Gitlab, new GitlabProvider(http, clock, flows, allowlist)],
          [ProviderId.Bitbucket, new BitbucketProvider(http, clock, flows, allowlist)],
          [ProviderId.Slack, new SlackProvider(http, clock, flows, allowlist)],
          [ProviderId.Spotify, new SpotifyProvider(http, clock, flows, allowlist)],
          [ProviderId.Figma, new FigmaProvider(http, clock, flows, allowlist)],
          [ProviderId.Zoom, new ZoomProvider(http, clock, flows, allowlist)],
          [ProviderId.Kakao, new KakaoProvider(http, clock, flows, allowlist)],
          [ProviderId.Line, new LineProvider(http, clock, flows, allowlist)],
          [ProviderId.Notion, new NotionProvider(http, clock, flows, allowlist)],
        ]);
      },
    },
    ProviderRegistry,
    ProviderSignIn,
    OAuthService,
    OAuthCodeFlow,
    IdTokenNonceService,
    IdTokenFlow,
  ],
})
export class OAuthModule {}
