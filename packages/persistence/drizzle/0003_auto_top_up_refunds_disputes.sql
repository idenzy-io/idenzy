CREATE TABLE "payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"top_up_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_dispute_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"withdrawn_from_credit_cents" bigint DEFAULT 0 NOT NULL,
	"withdrawn_to_debt_cents" bigint DEFAULT 0 NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"reinstated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_disputes_amount_ck" CHECK (amount_cents > 0),
	CONSTRAINT "payment_disputes_withdrawal_ck" CHECK (withdrawn_from_credit_cents >= 0 and withdrawn_to_debt_cents >= 0
          and withdrawn_from_credit_cents + withdrawn_to_debt_cents in (0, amount_cents)),
	CONSTRAINT "payment_disputes_order_ck" CHECK (reinstated_at is null or withdrawn_at is not null)
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"top_up_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_refund_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"state" text NOT NULL,
	"reversed_from_credit_cents" bigint DEFAULT 0 NOT NULL,
	"reversed_to_debt_cents" bigint DEFAULT 0 NOT NULL,
	"clawed_back_at" timestamp with time zone,
	"restored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_amount_ck" CHECK (amount_cents > 0),
	CONSTRAINT "payment_refunds_reversal_ck" CHECK (reversed_from_credit_cents >= 0 and reversed_to_debt_cents >= 0
          and reversed_from_credit_cents + reversed_to_debt_cents in (0, amount_cents)),
	CONSTRAINT "payment_refunds_order_ck" CHECK (restored_at is null or clawed_back_at is not null)
);
--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "auto_top_up_daily_limit" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "auto_top_up_failures" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "auto_top_up_last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "auto_top_up_suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "auto_top_up_suspended_reason" text;--> statement-breakpoint
ALTER TABLE "payment_disputes" ADD CONSTRAINT "payment_disputes_top_up_id_top_ups_id_fk" FOREIGN KEY ("top_up_id") REFERENCES "public"."top_ups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_top_up_id_top_ups_id_fk" FOREIGN KEY ("top_up_id") REFERENCES "public"."top_ups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_disputes_provider_dispute_key" ON "payment_disputes" USING btree ("provider","provider_dispute_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_org_created_idx" ON "payment_disputes" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_provider_refund_key" ON "payment_refunds" USING btree ("provider","provider_refund_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_org_created_idx" ON "payment_refunds" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "top_ups_org_automatic_open_key" ON "top_ups" USING btree ("org_id") WHERE trigger = 'automatic' and settled_at is null;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_auto_top_up_limit_ck" CHECK (auto_top_up_daily_limit between 1 and 10);--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_auto_top_up_suspension_ck" CHECK ((auto_top_up_suspended_at is null) = (auto_top_up_suspended_reason is null));