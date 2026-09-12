CREATE TABLE "org_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "org_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "org_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_security_settings" (
	"org_id" uuid NOT NULL,
	"require_mfa" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_security_settings_org_id_pk" PRIMARY KEY("org_id")
);
--> statement-breakpoint
ALTER TABLE "org_security_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "org_invitations_org_email_open_key" ON "org_invitations" USING btree ("org_id","email") WHERE accepted_at is null and revoked_at is null;--> statement-breakpoint
CREATE INDEX "org_invitations_expires_idx" ON "org_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_key" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_single_owner_key" ON "org_members" USING btree ("org_id") WHERE role = 'owner';--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "orgs_org_isolation" ON "orgs" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_invitations_org_isolation" ON "org_invitations" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_members_org_isolation" ON "org_members" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_security_settings_org_isolation" ON "org_security_settings" AS PERMISSIVE FOR ALL TO "idenzy_app" USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);