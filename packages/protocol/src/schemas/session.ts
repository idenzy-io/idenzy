import { z } from "zod";
import { AuthMethod, SessionRevokeReason } from "../enums/auth.js";
import { isoDateTimeSchema, sessionIdSchema } from "./common.js";
import { publicUserSchema } from "./user.js";

const authMethodValues = Object.values(AuthMethod) as [AuthMethod, ...AuthMethod[]];
const revokeReasonValues = Object.values(SessionRevokeReason) as [
  SessionRevokeReason,
  ...SessionRevokeReason[],
];

/** A session as shown in "your devices". Contains no token material. */
export const sessionSummarySchema = z.object({
  id: sessionIdSchema,
  deviceName: z.string().max(200).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().max(500).nullable(),
  amr: z.array(z.enum(authMethodValues)),
  createdAt: isoDateTimeSchema,
  lastActiveAt: isoDateTimeSchema,
  absoluteExpiresAt: isoDateTimeSchema,
  revokedAt: isoDateTimeSchema.nullable(),
  revokeReason: z.enum(revokeReasonValues).nullable(),
  current: z.boolean(),
});

/**
 * What a successful authentication returns.
 *
 * The refresh token is present only for non-cookie clients (mobile, server). On the
 * web it is set as a first-party HttpOnly cookie and never reaches JavaScript
 * (PROJECT.md 4.3).
 */
export const sessionCreatedSchema = z.object({
  user: publicUserSchema,
  sessionId: sessionIdSchema,
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  refreshToken: z.string().optional(),
});

/**
 * What a refresh returns.
 *
 * `user` is absent unless the caller asked for it, and the default is the original reason it
 * was absent entirely: a refresh is a token operation, and re-sending the profile on every
 * rotation would make the most frequent endpoint in the system also the one that leaks the
 * most if a token is misdirected.
 *
 * The exception is the one refresh that is not routine. A browser SDK starting up has a
 * cookie and nothing else, so without this it would rotate and then immediately fetch the
 * profile, paying two round trips on every page load. The rotation already loads the user to
 * check the account may sign in, so asking for it there costs nothing but the bytes.
 */
export const sessionRefreshedSchema = z.object({
  sessionId: sessionIdSchema,
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  refreshToken: z.string().optional(),
  user: publicUserSchema.optional(),
});

/** "Your devices". Ordered most recently active first, with the caller's own marked. */
export const sessionListSchema = z.object({
  sessions: z.array(sessionSummarySchema),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionCreated = z.infer<typeof sessionCreatedSchema>;
export type SessionRefreshed = z.infer<typeof sessionRefreshedSchema>;
export type SessionList = z.infer<typeof sessionListSchema>;
