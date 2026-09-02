import { z } from "zod";
import { emailSchema, isoDateTimeSchema, phoneSchema, userIdSchema } from "./common.js";

/**
 * The user as a customer's application sees it.
 *
 * `metadataPrivate` is deliberately absent: it is readable only through the
 * management API with a secret key, never through a client SDK.
 */
export const publicUserSchema = z.object({
  id: userIdSchema,
  email: emailSchema.nullable(),
  emailVerified: z.boolean(),
  phone: phoneSchema.nullable(),
  phoneVerified: z.boolean(),
  displayName: z.string().max(200).nullable(),
  avatarUrl: z.url().nullable(),
  metadataPublic: z.record(z.string(), z.unknown()),
  createdAt: isoDateTimeSchema,
  lastSignInAt: isoDateTimeSchema.nullable(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;
