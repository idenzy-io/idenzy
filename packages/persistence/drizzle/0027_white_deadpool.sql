CREATE TABLE "billing_settings" (
	"org_id" uuid NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"auto_top_up_enabled" boolean DEFAULT false NOT NULL,
	"auto_top_up_threshold_cents" bigint DEFAULT 0 NOT NULL,
	"auto_top_up_amount_cents" bigint DEFAULT 0 NOT NULL,
	"auto_top_up_method_id" uuid,
	"spend_alert_enabled" boolean DEFAULT false NOT NULL,
	"spend_alert_threshold_cents" bigint DEFAULT 0 NOT NULL,
	"spend_alert_sent_for_month" date,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_settings_org_id_pk" PRIMARY KEY("org_id"),
	CONSTRAINT "billing_settings_auto_top_up_ck" CHECK (not auto_top_up_enabled or auto_top_up_amount_cents >= auto_top_up_threshold_cents)
);
--> statement-breakpoint
ALTER TABLE "billing_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "credit_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"remaining_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"top_up_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "credit_grants_amount_ck" CHECK (amount_cents > 0),
	CONSTRAINT "credit_grants_remaining_ck" CHECK (remaining_cents between 0 and amount_cents)
);
--> statement-breakpoint
ALTER TABLE "credit_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"item" text NOT NULL,
	"quantity" bigint DEFAULT 0 NOT NULL,
	"unit_rate_millicents" integer DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text NOT NULL,
	"total_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"provider" text NOT NULL,
	"provider_invoice_id" text,
	"pdf_uri" text,
	"issued_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_method_id" text NOT NULL,
	"brand" text NOT NULL,
	"last4" text NOT NULL,
	"expiry_month" smallint NOT NULL,
	"expiry_year" smallint NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_expiry_month_ck" CHECK (expiry_month between 1 and 12)
);
--> statement-breakpoint
ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "top_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"state" text NOT NULL,
	"trigger" text NOT NULL,
	"provider" text NOT NULL,
	"provider_intent_id" text,
	"payment_method_id" uuid,
	"card_brand" text,
	"card_last4" text,
	"failure_code" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "top_ups_amount_ck" CHECK (amount_cents > 0)
);
--> statement-breakpoint
ALTER TABLE "top_ups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_grants_org_expiry_idx" ON "credit_grants" USING btree ("org_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_invoice_project_item_key" ON "invoice_lines" USING btree ("invoice_id","project_id","item");--> statement-breakpoint
CREATE INDEX "invoice_lines_org_idx" ON "invoice_lines" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_key" ON "invoices" USING btree ("org_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_period_key" ON "invoices" USING btree ("org_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_provider_invoice_key" ON "invoices" USING btree ("provider","provider_invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_org_issued_idx" ON "invoices" USING btree ("org_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_provider_method_key" ON "payment_methods" USING btree ("provider","provider_method_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_org_default_key" ON "payment_methods" USING btree ("org_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "payment_methods_org_idx" ON "payment_methods" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_events_provider_event_key" ON "payment_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_provider_events_unprocessed_idx" ON "payment_provider_events" USING btree ("received_at") WHERE processed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "top_ups_provider_intent_key" ON "top_ups" USING btree ("provider","provider_intent_id");--> statement-breakpoint
CREATE INDEX "top_ups_org_created_idx" ON "top_ups" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "billing_settings_org_isolation" ON "billing_settings" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "credit_grants_org_isolation" ON "credit_grants" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "invoice_lines_org_isolation" ON "invoice_lines" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "invoices_org_isolation" ON "invoices" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "payment_methods_org_isolation" ON "payment_methods" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "top_ups_org_isolation" ON "top_ups" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);