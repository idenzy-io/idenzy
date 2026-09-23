CREATE TABLE "operator_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"action" text NOT NULL,
	"org_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_actions_reason_ck" CHECK (length(trim(reason)) > 0)
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	CONSTRAINT "staff_email_domain_ck" CHECK (email ~ '^[a-z0-9._%+-]+@idenzy\.io$'),
	CONSTRAINT "staff_role_ck" CHECK (role in ('support', 'billing', 'admin')),
	CONSTRAINT "staff_deactivated_ck" CHECK (active = (deactivated_at is null))
);
--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_actions_org_idx" ON "operator_actions" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "operator_actions_staff_idx" ON "operator_actions" USING btree ("staff_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_key" ON "staff" USING btree ("email");