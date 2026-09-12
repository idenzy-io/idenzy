ALTER TABLE "audit_events" ADD COLUMN "outbox_seq" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_outbox_seq_key" ON "audit_events" USING btree ("created_at","outbox_seq");