-- `resolve_org_membership` answers when the member was last seen, so the touch is bounded.
--
-- `org_members.last_active_at` has existed since 0025 with a column on the members screen
-- and nothing that ever wrote it, so a dormant seat and an active one read the same. The
-- write belongs on the membership check, because that is the one thing every dashboard
-- request under `/v1/orgs/:orgId` already does — but a write per request would put an
-- UPDATE on the busiest row in the control plane for a column read once a month.
--
-- Bounding it needs the current value, and the guard has nowhere else to get it: this
-- lookup runs before `app.org_id` is bound, so a repository read would be refused by the
-- policy it is deciding. Returning the column here costs nothing — it is the same row on
-- the same index seek — and lets the caller skip the write on every request but the
-- first of a member's day.
--
-- Still narrow in the way 0036 made it narrow: the subject is the user id from a verified
-- access token and no argument selects a different one. `last_active_at` is that same
-- caller's own column, so returning it discloses nothing they did not supply.
--
-- A return type cannot be changed by CREATE OR REPLACE, so this drops and recreates — and
-- privileges do not survive the drop, which is why 0036's REVOKE and GRANT are repeated
-- below rather than assumed. Without them the function looks healthy and `idenzy_app`
-- loses its only membership lookup, so every dashboard request answers as if the caller
-- were in no organisation at all.

--> statement-breakpoint
DROP FUNCTION IF EXISTS resolve_org_membership(uuid, uuid);

--> statement-breakpoint
CREATE FUNCTION resolve_org_membership(p_user_id uuid, p_org_id uuid)
RETURNS TABLE (member_id uuid, role text, last_active_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function that resolves unqualified names through
-- the caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  SELECT m.id, m.role, m.last_active_at
  FROM public.org_members m
  WHERE m.user_id = p_user_id
    AND m.org_id = p_org_id
  LIMIT 1;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_org_membership(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_org_membership(uuid, uuid) TO idenzy_app;
