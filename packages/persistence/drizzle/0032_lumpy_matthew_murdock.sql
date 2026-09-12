-- Moves every outbox consumer's watermark from a timestamp to the sequence 0031 added,
-- and rebuilds the reader around it.
--
-- The backfill is exact rather than approximate. A consumer that had read everything up
-- to and including `position` has, by definition, read every row whose `created_at` is at
-- or before it, so the equivalent sequence watermark is the largest `seq` among them.
-- Rows sharing that instant are included, which is the conservative direction: the worst
-- case is that the relay does not re-read an event it had already chained, and the bad
-- direction — skipping one it had not — cannot happen.
--
-- `outbox_events_since` is dropped and recreated rather than replaced, because Postgres
-- refuses to let CREATE OR REPLACE change a function's argument list. That is the trap
-- migration 0012 hit: privileges do not survive a DROP, so the REVOKE and GRANT below are
-- not ceremony. Forgetting them fails in the quietest possible way — the relay loses the
-- only read it has, the audit trail simply stops growing, and the function itself looks
-- perfectly healthy.
--
-- The new signature keeps a time bound alongside the sequence, and it is not redundant.
-- A relay with no offset row must not read the outbox from the beginning; it starts a
-- bounded distance back, which is what `p_not_before` expresses. In steady state the
-- caller passes null and the sequence alone decides.

--> statement-breakpoint
UPDATE relay_offsets
SET position_seq = COALESCE(
  (SELECT max(o.seq) FROM outbox o WHERE o.created_at <= relay_offsets.position),
  0
)
WHERE position_seq IS NULL;

--> statement-breakpoint
DROP FUNCTION IF EXISTS outbox_events_since(text, timestamptz);

--> statement-breakpoint
CREATE FUNCTION outbox_events_since(
  p_topic text,
  p_since_seq bigint,
  p_not_before timestamptz
)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  topic text,
  payload jsonb,
  created_at timestamptz,
  seq bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function that resolves unqualified names through
-- the caller's search_path is a privilege-escalation vector. 0023 set `public` here,
-- which was weaker than the functions around it; this is the correction.
SET search_path = ''
AS $$
  SELECT o.id, o.project_id, o.topic, o.payload, o.created_at, o.seq
  FROM public.outbox o
  WHERE o.topic = p_topic
    AND o.seq > p_since_seq
    AND (p_not_before IS NULL OR o.created_at >= p_not_before)
  -- By seq alone. Ordering by created_at first would reintroduce the tie the sequence
  -- exists to break, and `id` as the tiebreaker is a random uuid.
  ORDER BY o.seq
  LIMIT 1000;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION outbox_events_since(text, bigint, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION outbox_events_since(text, bigint, timestamptz) TO idenzy_app;

--> statement-breakpoint
-- What a relay with no offset row starts from: the newest event already older than its
-- lookback, so a cold start reads forward from a bounded point instead of from the
-- beginning of the table. Narrow on purpose, like every other function the relay holds.
CREATE OR REPLACE FUNCTION outbox_seq_before(p_topic text, p_at timestamptz)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(max(o.seq), 0)
  FROM public.outbox o
  WHERE o.topic = p_topic
    AND o.created_at < p_at;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION outbox_seq_before(text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION outbox_seq_before(text, timestamptz) TO idenzy_app;
