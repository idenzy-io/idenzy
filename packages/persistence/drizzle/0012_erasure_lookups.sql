CREATE INDEX "auth_codes_user_idx" ON "auth_codes" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_user_idx" ON "magic_link_tokens" USING btree ("project_id","user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE INDEX "oauth_flows_link_user_idx" ON "oauth_flows" USING btree ("project_id","link_user_id") WHERE link_user_id is not null;--> statement-breakpoint
CREATE INDEX "webauthn_challenges_user_idx" ON "webauthn_challenges" USING btree ("project_id","user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE INDEX "outbox_user_idx" ON "outbox" USING btree ("project_id",("payload"->>'userId')) WHERE "outbox"."payload" ? 'userId';--> statement-breakpoint
CREATE INDEX "webhook_deliveries_user_idx" ON "webhook_deliveries" USING btree ("project_id",("payload"->>'user')) WHERE "webhook_deliveries"."payload" is not null;--> statement-breakpoint
CREATE INDEX "mfa_challenges_user_idx" ON "mfa_challenges" USING btree ("project_id","user_id");