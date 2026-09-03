-- The audit relay writes across tenants, and `audit_events` is tenant-scoped.
--
-- This is the failure the first version of the relay hit, and it is worth writing down
-- because it fails in the quietest possible way. `audit_events` has FORCE ROW LEVEL
-- SECURITY and a policy keyed on `current_setting('app.project_id')`. A relay serves every
-- project at once and therefore sets no such variable, so the policy's WITH CHECK refuses
-- every insert and its USING clause hides every row: the trail stays empty, no error
-- reaches a user, and the only symptom is a compliance control that records nothing.
--
-- The fix is the one migration 0002 used for project resolution and 0015 used for the
-- revocation reader: SECURITY DEFINER functions, each scoped to exactly one job. They are
-- deliberately not a general escape hatch. The append takes the columns of one entry and
-- nothing else, and the two reads take a project id and return that project's trail, which
-- is no more than a tenant-scoped read of the same table already gives.
--
-- What they do not do is matter more. None of them can UPDATE or DELETE, so the
-- append-only privilege shape set in 0001 is untouched: a bug in the relay can add a wrong
-- entry, and still cannot remove or alter a right one (PROJECT.md 4.13.3).

--> statement-breakpoint
CREATE OR REPLACE FUNCTION append_audit_event(
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
  p_created_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
-- Empty search_path: a SECURITY DEFINER function resolving unqualified names through the
-- caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  INSERT INTO public.audit_events
    (project_id, actor_type, actor_id, action, target, ip, ua, metadata,
     prev_hash, entry_hash, created_at)
  VALUES
    (p_project_id, p_actor_type, p_actor_id, p_action, p_target, p_ip, p_ua, p_metadata,
     p_prev_hash, p_entry_hash, p_created_at);
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION append_audit_event(uuid, text, text, text, text, text, text, jsonb, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION append_audit_event(uuid, text, text, text, text, text, text, jsonb, text, text, timestamptz) TO idenzy_app;

--> statement-breakpoint
-- Ordered by seq and not created_at, which is the whole reason 0022 added the column: a
-- timestamp ties at millisecond precision, and a tie here is two entries claiming the same
-- predecessor.
CREATE OR REPLACE FUNCTION audit_chain_tip(p_project_id uuid)
RETURNS TABLE (entry_hash text, seq bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT a.entry_hash, a.seq
  FROM public.audit_events a
  WHERE a.project_id = p_project_id
  ORDER BY a.seq DESC
  LIMIT 1;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_chain_tip(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_chain_tip(uuid) TO idenzy_app;

--> statement-breakpoint
-- For the verifier, which has to read a whole project's chain in order to check it. The
-- value of a hash chain is entirely in somebody checking it (PROJECT.md 4.13.3).
CREATE OR REPLACE FUNCTION audit_chain_for(p_project_id uuid)
RETURNS TABLE (
  project_id uuid,
  actor_type text,
  actor_id text,
  action text,
  target text,
  metadata jsonb,
  prev_hash text,
  entry_hash text,
  created_at timestamptz,
  seq bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT a.project_id, a.actor_type, a.actor_id, a.action, a.target, a.metadata,
         a.prev_hash, a.entry_hash, a.created_at, a.seq
  FROM public.audit_events a
  WHERE a.project_id = p_project_id
  ORDER BY a.seq ASC;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_chain_for(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_chain_for(uuid) TO idenzy_app;
