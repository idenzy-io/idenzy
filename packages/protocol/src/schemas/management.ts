import { z } from "zod";
import { MemberRole } from "../enums/tenancy.js";

/**
 * What the dashboard asks the management API for, and what it gets back.
 *
 * A separate surface from `schemas/auth.ts` on purpose: these are read by our own panel
 * and by a customer's scripts against the management API, and they describe the control
 * plane rather than an authentication. Nothing here is part of the Session Protocol.
 */

/** An organisation the signed-in person belongs to, as the switcher lists it. */
export const orgSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The caller's own membership. Never anybody else's; that is the members endpoint. */
  memberId: z.string(),
  role: z.enum(MemberRole),
  joinedAt: z.iso.datetime(),
});
export type OrgSummary = z.infer<typeof orgSummarySchema>;

export const orgListSchema = z.object({
  organisations: z.array(orgSummarySchema),
});
export type OrgList = z.infer<typeof orgListSchema>;
