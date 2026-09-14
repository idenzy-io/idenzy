CREATE TABLE "org_debts" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"debt_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_debts_not_negative" CHECK (debt_cents >= 0)
);
--> statement-breakpoint
ALTER TABLE "org_debts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usage_billing_state" (
	"org_id" uuid NOT NULL,
	"period" date NOT NULL,
	"billed_mau" bigint DEFAULT 0 NOT NULL,
	"billed_cents" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_billing_state_org_id_period_pk" PRIMARY KEY("org_id","period"),
	CONSTRAINT "usage_billing_state_not_negative" CHECK (billed_mau >= 0 and billed_cents >= 0)
);
--> statement-breakpoint
ALTER TABLE "usage_billing_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usage_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period" date NOT NULL,
	"item" text NOT NULL,
	"quantity" bigint NOT NULL,
	"charged_cents" bigint NOT NULL,
	"from_credit_cents" bigint DEFAULT 0 NOT NULL,
	"to_debt_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_charges_covered" CHECK (from_credit_cents + to_debt_cents = charged_cents and charged_cents >= 0)
);
--> statement-breakpoint
ALTER TABLE "usage_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "usage_charges_org_period_idx" ON "usage_charges" USING btree ("org_id","period");--> statement-breakpoint
CREATE INDEX "usage_charges_org_recent_idx" ON "usage_charges" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "org_debts_org_isolation" ON "org_debts" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "usage_billing_state_org_isolation" ON "usage_billing_state" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "usage_charges_org_isolation" ON "usage_charges" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);