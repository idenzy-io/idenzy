-- Hand-edited: drizzle-kit does not generate sequences (ADR-0001), and the column it
-- emits below defaults from one. The CREATE has to run first or the ALTER fails, so it
-- lives here rather than in a separate custom migration.
--
-- Why the column exists at all. The audit hash chain links each entry to its project's
-- current tip, and `created_at` alone cannot name that tip: it ties at millisecond
-- precision, so two entries written in the same millisecond would both claim the same
-- predecessor and fork the chain (PROJECT.md 4.13.3). One cluster sequence orders every
-- partition, which is what makes "the newest entry for this project" a question with one
-- answer.
--
-- Owned by idenzy_owner and USAGE granted to idenzy_app, which is the least the insert
-- needs: a sequence is not covered by the table grants that make audit_events append-only.
CREATE SEQUENCE IF NOT EXISTS "audit_events_seq" AS bigint START WITH 1 INCREMENT BY 1;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE "audit_events_seq" TO idenzy_app;
--> statement-breakpoint
CREATE TABLE "relay_offsets" (
	"consumer" text PRIMARY KEY NOT NULL,
	"position" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "seq" bigint DEFAULT nextval('audit_events_seq') NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_events_project_seq_idx" ON "audit_events" USING btree ("project_id","seq");