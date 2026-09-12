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
