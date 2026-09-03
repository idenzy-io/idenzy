ALTER TABLE "oauth_flows" ALTER COLUMN "code_verifier_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_flows" ADD COLUMN "code_verifier_encrypted" text NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_flows" ADD COLUMN "link_user_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_flows" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_providers" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;