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

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionCreated = z.infer<typeof sessionCreatedSchema>;
