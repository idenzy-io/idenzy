CREATE TABLE "webhook_endpoint_stats" (
	"project_id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"day" date NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	CONSTRAINT "webhook_endpoint_stats_webhook_id_day_pk" PRIMARY KEY("webhook_id","day")
);
--> statement-breakpoint
ALTER TABLE "webhook_endpoint_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "webhooks_project_idx";--> statement-breakpoint
DROP INDEX "webhook_deliveries_webhook_idx";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "sequence" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "status" text DEFAULT 'queued' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempt_log" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "secret_ciphertext" text NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "previous_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "previous_secret_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "rolled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "all_events" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "disabled_by" uuid;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoint_stats" ADD CONSTRAINT "webhook_endpoint_stats_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."next_attempt_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_webhook_sequence_key" ON "webhook_deliveries" USING btree ("webhook_id","sequence");--> statement-breakpoint
CREATE INDEX "webhooks_project_enabled_idx" ON "webhooks" USING btree ("project_id","enabled");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE POLICY "webhook_endpoint_stats_tenant_isolation" ON "webhook_endpoint_stats" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);