-- Grants for the table added in 0022, and the cross-tenant read the audit relay needs.
--
-- `relay_offsets` is deliberately not a tenant table: it has no `project_id`, no RLS
-- policy and no isolation test, because a relay serves every project at once. So it does
-- not go through the FORCE RLS block the other migrations copy; it needs privileges and
-- nothing else.
--
-- `outbox_events_since` is the same shape as `revocation_events_since` and exists for the
-- same reason: a relay has no `app.project_id`, so RLS would match nothing. It is narrow
-- on purpose. One topic per call and a bounded window, which is what stops it becoming a
-- way to read every event any project has ever emitted.

--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "relay_offsets" TO idenzy_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION outbox_events_since(topic_name text, since timestamptz)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  topic text,
  payload jsonb,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.project_id, o.topic, o.payload, o.created_at
  FROM outbox o
  WHERE o.topic = topic_name
    AND o.created_at > since
  ORDER BY o.created_at, o.id
  LIMIT 1000;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION outbox_events_since(text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION outbox_events_since(text, timestamptz) TO idenzy_app;
