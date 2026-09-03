CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ceremony" text NOT NULL,
	"challenge_hash" text NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webauthn_relying_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"rp_id" text NOT NULL,
	"rp_name" text NOT NULL,
	"origins" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webauthn_relying_parties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD COLUMN "backup_state" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_challenges_hash_key" ON "webauthn_challenges" USING btree ("challenge_hash");--> statement-breakpoint
CREATE INDEX "webauthn_challenges_expiry_idx" ON "webauthn_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_relying_parties_project_key" ON "webauthn_relying_parties" USING btree ("project_id");--> statement-breakpoint
CREATE POLICY "webauthn_challenges_tenant_isolation" ON "webauthn_challenges" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "webauthn_relying_parties_tenant_isolation" ON "webauthn_relying_parties" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid) WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);