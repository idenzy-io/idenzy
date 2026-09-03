import { OauthProviderError } from "@idenzy/core/errors";
import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  OAuthFlowStore,
  ProviderProfile,
  RedirectAllowlist,
  TokenGrant,
} from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";
import type { JWTPayload } from "jose";
import {
  assertExactIssuer,
  OidcProvider,
  stringClaim,
  subjectOf,
  verifiedEmailClaim,
} from "../oidc-provider.js";

/** Slack namespaces its own claims, so the workspace arrives under a URL rather than a word. */
const TEAM_ID = "https://slack.com/team_id";

/**
 * Sign in with Slack (PROJECT.md 4.6).
 *
 * OIDC, so the profile is in the id_token and `email_verified` is Slack's own assertion.
 *
 * The part that is not like the others is the subject. A Slack member id is unique inside
 * one workspace and not across two, so `sub` alone is not an identity: two people in two
 * unrelated workspaces can hold the same `U…`, and an account keyed on it would hand the
 * second of them the first one's account. The workspace is therefore part of the subject,
 * which also matches what a Slack identity means to a customer: the same person in two
 * workspaces is two identities, and either can be linked to one user.
 *
 * The other quirk is that this is a Slack Web API method wearing OAuth's clothes. It
 * answers 200 with `ok: false` for a bad code, so the base's status check cannot see the
 * failure and `mapGrant` looks for it.
 */
export class SlackProvider extends OidcProvider {
  override readonly id = ProviderId.Slack;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://slack.com/openid/connect/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://slack.com/api/openid.connect.token";
  }

  protected override assertIssuer(claims: JWTPayload): void {
    assertExactIssuer(claims, "https://slack.com", this.id);
  }

  protected override jwksUri(): string {
    return "https://slack.com/openid/connect/keys";
  }

  protected override defaultScopes(): readonly string[] {
    return ["openid", "profile", "email"];
  }

  /** A 200 carrying `ok: false` is Slack reporting a failure the base would have missed. */
  protected override mapGrant(raw: Readonly<Record<string, unknown>>): TokenGrant {
    if (raw["ok"] === false) {
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "slack answered ok:false", body: raw["error"] },
      });
    }
    return super.mapGrant(raw);
  }

  protected override mapClaims(claims: JWTPayload): ProviderProfile {
    const team = claims[TEAM_ID];
    if (typeof team !== "string" || team.length === 0) {
      // Without the workspace there is no unique subject to store, and storing the member
      // id alone would collide with a stranger in another workspace.
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "the id_token named no workspace" },
      });
    }

    return {
      providerUserId: `${team}:${subjectOf(claims, this.id)}`,
      email: stringClaim(claims, "email"),
      emailVerified: verifiedEmailClaim(claims),
      displayName: stringClaim(claims, "name"),
      avatarUrl: stringClaim(claims, "picture"),
    };
  }
}
