import { z } from "zod";
import { ApiKeyKind, MemberRole } from "../enums/tenancy.js";

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

/** A region a project can be pinned to. Only cells we actually run are ever listed. */
export const regionSchema = z.object({
  code: z.string(),
  jurisdiction: z.string(),
  /** The API host projects in this cell are reached on. What an SDK is pointed at. */
  endpoint: z.string(),
});
export type Region = z.infer<typeof regionSchema>;

export const regionListSchema = z.object({ regions: z.array(regionSchema) });
export type RegionList = z.infer<typeof regionListSchema>;

/**
 * A project's name, as the panel and the management API accept it.
 *
 * A label for the dashboard and nothing an end user ever reads, because we render no page
 * they could read it on (PROJECT.md 1.1). Trimmed, because a name that differs from
 * another only by a space is two rows nobody can tell apart in a switcher.
 */
export const projectNameSchema = z.string().trim().min(1).max(80);

/**
 * Getting started: the two answers that decide something, and the two that do not.
 *
 * The name and the region are required because both are written into rows that cannot be
 * changed afterwards — a cell is pinned at creation and moving a project is an audited
 * migration, not a setting (PROJECT.md 4.13.5). The rest is a survey: skipping it is a
 * normal answer and stores no row at all.
 */
export const startOnboardingSchema = z.object({
  projectName: projectNameSchema,
  /** `region_cells.code`. Checked against the active list, never trusted from the body. */
  region: z.string().min(1).max(40),
  organisationName: z.string().trim().min(1).max(120).optional(),
  useCase: z.string().trim().min(1).max(500).optional(),
  heardFrom: z.string().trim().min(1).max(200).optional(),
});
export type StartOnboarding = z.infer<typeof startOnboardingSchema>;

export const createProjectSchema = z.object({
  name: projectNameSchema,
  region: z.string().min(1).max(40),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  /** The organisation that owns it. The panel keys every screen on the pair. */
  orgId: z.string(),
  name: z.string(),
  region: z.string(),
  plan: z.string(),
  complianceTier: z.string(),
  createdAt: z.iso.datetime(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectListSchema = z.object({ projects: z.array(projectSummarySchema) });
export type ProjectList = z.infer<typeof projectListSchema>;

/** What getting started answers with: the organisation made, and the project in it. */
export const onboardingResultSchema = z.object({
  organisation: orgSummarySchema,
  project: projectSummarySchema,
});
export type OnboardingResult = z.infer<typeof onboardingResultSchema>;

/**
 * Everything the panel's shell needs about the signed-in person, in one call.
 *
 * One request rather than one per screen, because the drawer, the switcher and the
 * breadcrumb all want the same three facts before anything can render, and three round
 * trips to draw a sidebar is three chances to show a half-built page.
 *
 * The identity is deliberately absent. It is already in the access token the caller
 * presented, and `@idenzy/js` hands it to the panel as `useUser()`; repeating it here
 * would be a second copy of a fact, which is a second thing to keep true.
 *
 * Balance is absent too, and that is a decision rather than an omission. Nothing can fund
 * an account yet, so every figure would be a real zero where the billing screens currently
 * show a fixture — a regression dressed as progress. It joins this shape when a top-up can
 * actually happen.
 */
export const meSchema = z.object({
  organisations: z.array(orgSummarySchema),
  /** Every project across every organisation the caller belongs to. */
  projects: z.array(projectSummarySchema),
});
export type Me = z.infer<typeof meSchema>;

/*
 * API keys.
 */

/**
 * A key as the panel lists it. Never the key itself.
 *
 * `prefix` is the first characters, kind included — enough to pick a row out of a log line
 * or an `.env` file and far too few to be worth guessing the rest of. The value exists in
 * exactly one response, the one that created it, and nowhere after.
 */
export const apiKeySummarySchema = z.object({
  id: z.string(),
  kind: z.enum(ApiKeyKind),
  prefix: z.string(),
  /** Nothing reads these yet. Present because the column is, and empty until it is used. */
  scopes: z.array(z.string()),
  createdAt: z.iso.datetime(),
  /** An observation of when it was last presented, never proof of who holds it. */
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;

export const apiKeyListSchema = z.object({ keys: z.array(apiKeySummarySchema) });
export type ApiKeyList = z.infer<typeof apiKeyListSchema>;

export const createApiKeySchema = z.object({ kind: z.enum(ApiKeyKind) });
export type CreateApiKey = z.infer<typeof createApiKeySchema>;

/**
 * What creating a key answers with, and the only time the key is ever in a response.
 *
 * `secret` is named for what it is rather than `key`, so a log line or a screenshot that
 * contains this object reads as something that should not have been kept.
 */
export const createdApiKeySchema = z.object({
  key: apiKeySummarySchema,
  /** Shown once. Only its digest is stored, so nothing can produce it again. */
  secret: z.string(),
});
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;
