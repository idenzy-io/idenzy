/** Social and enterprise identity providers we implement. */
export const ProviderId = {
  Google: "google",
  Apple: "apple",
  Github: "github",
  Microsoft: "microsoft",
  Facebook: "facebook",
  Discord: "discord",
  X: "x",
  Twitch: "twitch",
  Linkedin: "linkedin",
  Gitlab: "gitlab",
  Bitbucket: "bitbucket",
  Slack: "slack",
  Spotify: "spotify",
  Notion: "notion",
  Figma: "figma",
  Kakao: "kakao",
  Line: "line",
  Zoom: "zoom",
  Oidc: "oidc",
} as const;
export type ProviderId = (typeof ProviderId)[keyof typeof ProviderId];

/**
 * How a project's OAuth credentials are supplied. `instant` uses our shared app and
 * is restricted to localhost and preview domains (PROJECT.md 4.6).
 */
export const OauthMode = {
  Instant: "instant",
  Custom: "custom",
} as const;
export type OauthMode = (typeof OauthMode)[keyof typeof OauthMode];
