-- Hand-edited, exactly as 0022 was and for the same reason one level down: drizzle-kit
-- does not generate sequences (ADR-0001), and the column it emits below defaults from
-- one. The CREATE has to run before the ALTER or the ALTER fails.
--
-- Why the outbox needs its own order. `audit_events.seq` exists because `created_at` ties
-- at millisecond precision and two entries in the same millisecond left the chain's tip
-- ambiguous (0022). The outbox has the same disease and it was never treated, which costs
-- two things.
--
-- The relay reads `outbox_events_since(topic, created_at)` ordered by `(created_at, id)`,
-- and `id` is a random uuid. Measured against a local database, three events enqueued in
-- a loop shared a millisecond on 29 runs in 30, and the relay handed them to the chain in
-- the wrong order on 20 of those. The trail's order was decided by a random number.
--
-- Worse, the watermark is that same `created_at` and the bound is exclusive. An event
-- sharing the last instant of a sweep — because it committed after the sweep's snapshot,
-- or because it fell past the function's LIMIT — is `created_at > since` false for ever.
-- It is never relayed, nothing errors, and the only symptom is an audit entry that does
-- not exist. The hash chain cannot detect that: it verifies what is there.
--
-- One cluster sequence fixes both. It is a total order, so the relay's output order is
-- the order events were enqueued, and it is unique, so an exclusive watermark skips
-- exactly the events already consumed and no others.
--
-- `position_seq` arrives nullable and `position` loses its NOT NULL here so 0032 has both
-- columns to backfill between. 0033 drops `position`. Three migrations rather than one
-- because drizzle-kit demands a TTY when a column is dropped and another added in the
-- same generate — it asks whether the pair is a rename, and there is no flag to answer.

--> statement-breakpoint
-- Owned by idenzy_owner and USAGE granted to idenzy_app, which is the least an insert
-- needs: a sequence is not covered by the table grants.
CREATE SEQUENCE IF NOT EXISTS "outbox_seq" AS bigint START WITH 1 INCREMENT BY 1;--> statement-breakpoint
GRANT USAGE ON SEQUENCE "outbox_seq" TO idenzy_app;--> statement-breakpoint
ALTER TABLE "relay_offsets" ALTER COLUMN "position" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "relay_offsets" ADD COLUMN "position_seq" bigint;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "seq" bigint DEFAULT nextval('outbox_seq') NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_topic_seq_idx" ON "outbox" USING btree ("topic","seq");
