ALTER TABLE "invoice_lines" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "invoice_email" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "hosted_url" text;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_invoice_email_ck" CHECK (billing_mode = 'prepaid' or invoice_email is not null);