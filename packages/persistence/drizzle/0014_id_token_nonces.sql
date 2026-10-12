CREATE TABLE "id_token_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"nonce_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "id_token_nonces" ADD CONSTRAINT "id_token_nonces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "id_token_nonces_hash_key" ON "id_token_nonces" USING btree ("nonce_hash");--> statement-breakpoint
CREATE INDEX "id_token_nonces_expiry_idx" ON "id_token_nonces" USING btree ("project_id","expires_at");