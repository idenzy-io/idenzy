CREATE TABLE "onboarding_responses" (
	"org_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"use_case" text,
	"heard_from" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_responses_org_id_pk" PRIMARY KEY("org_id")
);
--> statement-breakpoint
ALTER TABLE "onboarding_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "projects_org_isolation" ON "projects" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "onboarding_responses_org_isolation" ON "onboarding_responses" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);