CREATE TABLE "claim_templates" (
	"project_id" uuid NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"private_metadata_acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_templates_project_id_pk" PRIMARY KEY("project_id")
);
--> statement-breakpoint
ALTER TABLE "claim_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "claim_templates_tenant_isolation" ON "claim_templates" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);