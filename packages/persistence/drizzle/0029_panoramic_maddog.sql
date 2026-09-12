-- Resolving an invitation link is the org plane's chicken-and-egg problem.
--
-- `org_invitations` is protected by RLS keyed on current_setting('app.org_id'), but
-- somebody following a link is not in the organisation yet: the whole point of the link
-- is to tell us which organisation they are joining. So the lookup happens before that
-- value is known, and under RLS it would correctly return nothing.
--
-- This is the shape migration 0002 used for `resolve_project_by_host` and 0015 used for
-- the revocation reader, one plane up, and it is narrow for the same reasons.
--
-- It takes the hash and never the id. The caller hashes, so a token that would grant the
-- membership never reaches the database, its logs, or a pg_stat_statements entry; and an
-- unscoped lookup on a guessable handle would be a way into somebody else's organisation,
-- which is exactly what an id is.
--
-- It returns only what the join needs, and it applies the open-and-unexpired predicate
-- itself rather than handing that back to be checked in application code. A spent or
-- revoked invitation resolves to nothing here, so there is no window in which a caller
-- holds a row it is supposed to reject.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_open_invitation(p_token_hash text, p_now timestamptz)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  email text,
  role text,
  invited_by uuid,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function that resolves unqualified names through
-- the caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  SELECT i.id, i.org_id, i.email, i.role, i.invited_by, i.created_at, i.expires_at
  FROM public.org_invitations i
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > p_now
  LIMIT 1;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_open_invitation(text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_open_invitation(text, timestamptz) TO idenzy_app;
