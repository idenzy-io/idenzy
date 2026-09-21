CREATE TABLE "email_delivery_stats" (
	"project_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sent" bigint DEFAULT 0 NOT NULL,
	"delivered" bigint DEFAULT 0 NOT NULL,
	"bounced_hard" bigint DEFAULT 0 NOT NULL,
	"bounced_soft" bigint DEFAULT 0 NOT NULL,
	"complained" bigint DEFAULT 0 NOT NULL,
	"rejected" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_stats_project_id_day_pk" PRIMARY KEY("project_id","day")
);
--> statement-breakpoint
ALTER TABLE "email_delivery_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"project_id" uuid,
	"bounce_type" text,
	"bounce_sub_type" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "email_sending_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"bounce_rate_ppm" integer NOT NULL,
	"complaint_rate_ppm" integer NOT NULL,
	"observed_sends" bigint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" text,
	"released_reason" text
);
--> statement-breakpoint
ALTER TABLE "email_sending_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "email_delivery_stats_day_idx" ON "email_delivery_stats" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "email_provider_events_provider_event_key" ON "email_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "email_provider_events_unprocessed_idx" ON "email_provider_events" USING btree ("received_at") WHERE processed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_sending_holds_open_key" ON "email_sending_holds" USING btree ("project_id") WHERE released_at is null;--> statement-breakpoint
CREATE INDEX "email_sending_holds_project_opened_idx" ON "email_sending_holds" USING btree ("project_id","opened_at");--> statement-breakpoint
CREATE POLICY "email_delivery_stats_tenant_isolation" ON "email_delivery_stats" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "email_sending_holds_tenant_isolation" ON "email_sending_holds" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);