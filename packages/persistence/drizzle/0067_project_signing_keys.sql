CREATE TABLE "project_signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kid" text NOT NULL,
	"algorithm" text DEFAULT 'ES256' NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_key_wrapped" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "project_signing_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_signing_keys" ADD CONSTRAINT "project_signing_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_signing_keys_kid_key" ON "project_signing_keys" USING btree ("project_id","kid");--> statement-breakpoint
CREATE UNIQUE INDEX "project_signing_keys_primary_key" ON "project_signing_keys" USING btree ("project_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "project_signing_keys_live_idx" ON "project_signing_keys" USING btree ("project_id","retired_at");--> statement-breakpoint
CREATE POLICY "project_signing_keys_tenant_isolation" ON "project_signing_keys" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);