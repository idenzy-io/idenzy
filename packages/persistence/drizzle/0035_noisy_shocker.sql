-- Makes replaying an outbox event a no-op instead of a second audit entry.
--
-- The relay's own docstring claimed this already worked: "an entry that is already in the
-- trail is recognised by its own hash: the same event against the same tip produces the
-- same entry_hash, so replaying it is a no-op". The premise is false, and it is false in
-- the one case that matters. After the entry has been appended it is no longer against
-- the same tip — it *is* the tip, or something after it is — so a replay computes a
-- different `prev_hash`, therefore a different `entry_hash`, and collides with nothing.
-- `append_audit_event` was a plain INSERT, so the trail simply gained the same event
-- twice, linked into a chain that still verifies perfectly.
--
-- That is the worst shape a bug in an audit trail can take. Nothing errors, the verifier
-- says valid, and the record of what happened is wrong in the direction of claiming more
-- than occurred. A replay is not exotic either: any cold start re-reads its lookback
-- window, which is exactly the window it has already chained.
--
-- 0034 added `outbox_seq` and the unique index behind it. This makes the append use it.
-- `created_at` leads that index because a unique index on a partitioned table must carry
-- the partition key; it costs nothing, since a replayed event carries the same instant it
-- did the first time.
--
-- The function is dropped and recreated rather than replaced, because it gains an
-- argument and returns a boolean instead of void, and Postgres allows CREATE OR REPLACE
-- to change neither. Privileges do not survive a DROP — the trap migration 0012 hit — so
-- the REVOKE and GRANT below are load-bearing. Without them the relay silently loses its
-- only write.
--
-- The privilege shape from 0001 is untouched. The function still only ever INSERTs, so a
-- bug here can add a wrong entry and still cannot remove or alter a right one
-- (PROJECT.md 4.13.3).

--> statement-breakpoint
DROP FUNCTION IF EXISTS append_audit_event(
  uuid, text, text, text, text, text, text, jsonb, text, text, timestamptz
);

--> statement-breakpoint
CREATE FUNCTION append_audit_event(
  p_project_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_action text,
  p_target text,
  p_ip text,
  p_ua text,
  p_metadata jsonb,
  p_prev_hash text,
  p_entry_hash text,
  p_created_at timestamptz,
  p_outbox_seq bigint
)
-- True when this call wrote the entry, false when it was already there. The caller needs
-- the difference: on false the hash it computed was never stored, so it must not carry
-- that value forward as the project's tip.
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
-- Empty search_path: a SECURITY DEFINER function resolving unqualified names through the
-- caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  WITH appended AS (
    INSERT INTO public.audit_events
      (project_id, actor_type, actor_id, action, target, ip, ua, metadata,
       prev_hash, entry_hash, created_at, outbox_seq)
    VALUES
      (p_project_id, p_actor_type, p_actor_id, p_action, p_target, p_ip, p_ua, p_metadata,
       p_prev_hash, p_entry_hash, p_created_at, p_outbox_seq)
    -- A null outbox_seq never conflicts, which is the right reading: an entry with no
    -- outbox event behind it has nothing to be a replay of.
    ON CONFLICT (created_at, outbox_seq) DO NOTHING
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM appended);
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION append_audit_event(
  uuid, text, text, text, text, text, text, jsonb, text, text, timestamptz, bigint
) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION append_audit_event(
  uuid, text, text, text, text, text, text, jsonb, text, text, timestamptz, bigint
) TO idenzy_app;
