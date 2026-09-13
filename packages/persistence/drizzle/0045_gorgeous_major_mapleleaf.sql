CREATE TABLE "usage_periods" (
	"project_id" uuid NOT NULL,
	"period" date NOT NULL,
	"active_users" integer NOT NULL,
	"emails_sent" bigint NOT NULL,
	"sms_sent" bigint NOT NULL,
	"sms_verified" bigint NOT NULL,
	"sms_cost" numeric(12, 6) NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_periods_project_id_period_pk" PRIMARY KEY("project_id","period")
);
--> statement-breakpoint
ALTER TABLE "usage_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD COLUMN "mau" integer;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD COLUMN "mau_to_date" integer;--> statement-breakpoint
CREATE INDEX "usage_periods_period_idx" ON "usage_periods" USING btree ("period");--> statement-breakpoint
CREATE POLICY "usage_periods_tenant_isolation" ON "usage_periods" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);