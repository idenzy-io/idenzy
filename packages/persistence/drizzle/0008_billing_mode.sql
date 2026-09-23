ALTER TABLE "billing_settings" ADD COLUMN "billing_mode" text DEFAULT 'prepaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "invoice_terms_days" smallint DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_mode_ck" CHECK (billing_mode in ('prepaid', 'invoiced'));--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_terms_ck" CHECK (invoice_terms_days between 1 and 90);