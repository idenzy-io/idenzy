CREATE TABLE "sms_policies" (
	"project_id" uuid NOT NULL,
	"allowed_countries" text[] DEFAULT '{}' NOT NULL,
	"daily_spend_cap" numeric(12, 6) DEFAULT '2.000000' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"attestation_required" boolean DEFAULT true NOT NULL,
	"per_number_daily_limit" integer DEFAULT 5 NOT NULL,
	"per_ip_hourly_limit" integer DEFAULT 10 NOT NULL,
	"max_sends_per_verify" integer DEFAULT 6 NOT NULL,
	"sender_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_policies_project_id_pk" PRIMARY KEY("project_id")
);
--> statement-breakpoint
ALTER TABLE "sms_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD COLUMN "sms_verified" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE POLICY "sms_policies_tenant_isolation" ON "sms_policies" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);