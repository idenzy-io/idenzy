CREATE TABLE "mfa_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"session_id" uuid,
	"amr" text[] DEFAULT '{}' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mfa_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD COLUMN "counter" bigint;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mfa_challenges_expiry_idx" ON "mfa_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_recovery_codes_hash_key" ON "mfa_recovery_codes" USING btree ("project_id","code_hash");--> statement-breakpoint
CREATE INDEX "mfa_recovery_codes_user_idx" ON "mfa_recovery_codes" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_factors_user_type_key" ON "mfa_factors" USING btree ("project_id","user_id","type") WHERE verified_at is not null;--> statement-breakpoint
CREATE POLICY "mfa_challenges_tenant_isolation" ON "mfa_challenges" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mfa_recovery_codes_tenant_isolation" ON "mfa_recovery_codes" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);