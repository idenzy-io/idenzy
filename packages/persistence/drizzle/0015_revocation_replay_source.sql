-- Valkey is a cache, and the revocation set lives in it (ADR-0009).
--
-- Two things follow from that and neither is hypothetical. A Valkey restart empties every
-- project's set, so every published snapshot silently becomes "nothing is revoked" until
-- something writes to it again. And a write that failed while Valkey was unreachable is a
-- revocation that never reached the set at all.
--
-- The durable record already exists: every revocation site enqueues its event in the same
-- transaction as the revocation itself. This function is what lets a worker read those
-- events back and replay them, which is the reconciler ADR-0009 promises.
--
-- It has to cross tenants, because a relay serves every project and RLS is keyed on
-- current_setting('app.project_id'). The narrow fix is the same one migration 0002 used for
-- project resolution: a SECURITY DEFINER function owned by idenzy_owner, scoped to exactly
-- this read. It is deliberately not a general outbox reader. It returns two topics and
-- nothing else, so it cannot be turned into a way to read every event any project has
-- emitted, and the topics it does return carry only the ids the revocation set is keyed by.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION revocation_events_since(p_since timestamptz)
RETURNS TABLE (project_id uuid, topic text, payload jsonb, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function resolving unqualified names through the
-- caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  SELECT o.project_id, o.topic, o.payload, o.created_at
  FROM public.outbox o
  WHERE o.created_at >= p_since
    AND o.topic IN ('session.revoked', 'security.refresh_token_reused')
  ORDER BY o.created_at ASC
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION revocation_events_since(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION revocation_events_since(timestamptz) TO idenzy_app;
