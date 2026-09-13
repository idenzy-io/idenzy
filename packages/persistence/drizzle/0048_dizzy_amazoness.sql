CREATE TABLE "usage_hourly" (
	"project_id" uuid NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"mau_to_date" integer DEFAULT 0 NOT NULL,
	"emails_sent" bigint DEFAULT 0 NOT NULL,
	"sms_sent" bigint DEFAULT 0 NOT NULL,
	"sms_verified" bigint DEFAULT 0 NOT NULL,
	"sms_cost" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_hourly_project_id_hour_pk" PRIMARY KEY("project_id","hour")
);
--> statement-breakpoint
ALTER TABLE "usage_hourly" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "usage_hourly_hour_idx" ON "usage_hourly" USING btree ("hour");--> statement-breakpoint
CREATE POLICY "usage_hourly_tenant_isolation" ON "usage_hourly" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);