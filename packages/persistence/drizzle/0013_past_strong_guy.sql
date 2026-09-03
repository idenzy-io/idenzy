ALTER TABLE "auth_codes" ADD COLUMN "code_challenge" text;--> statement-breakpoint
ALTER TABLE "oauth_flows" ADD COLUMN "client_code_challenge" text;