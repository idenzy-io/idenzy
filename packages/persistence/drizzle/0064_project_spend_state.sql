CREATE TABLE "project_spend_state" (
	"project_id" uuid NOT NULL,
	"spendable" boolean NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"stale_after" timestamp with time zone NOT NULL,
	CONSTRAINT "project_spend_state_project_id_pk" PRIMARY KEY("project_id")
);
--> statement-breakpoint
ALTER TABLE "project_spend_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_spend_state" ADD CONSTRAINT "project_spend_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "project_spend_state_tenant_isolation" ON "project_spend_state" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);