-- Resolving which organisation a dashboard request acts on, before one is bound.
--
-- The same chicken-and-egg migration 0002 solved for projects and 0029 for invitations,
-- now on the org plane. `org_members` is protected by RLS keyed on
-- `current_setting('app.org_id')`, and this is the lookup that works out what that value
-- should be: a person signs in once and may belong to several organisations, so the
-- request names one and the server has to check the membership before it can bind it.
-- Under RLS that check would correctly return nothing.
--
-- Both functions take the user id from a verified access token and nothing from the
-- request body, which is what keeps them narrow. `resolve_org_membership` answers one
-- question — is this person in this organisation, and as what — and `orgs_for_user`
-- answers the list form of it. Neither can be asked about somebody else: there is no
-- argument that selects a different subject.
--
-- `orgs.name` comes back from the list, and that is the authorized read rather than a
-- leak: it is the name of an organisation the caller is a member of. Nothing here returns
-- a row for an organisation they are not in.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_org_membership(p_user_id uuid, p_org_id uuid)
RETURNS TABLE (member_id uuid, role text)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function that resolves unqualified names through
-- the caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  SELECT m.id, m.role
  FROM public.org_members m
  WHERE m.user_id = p_user_id
    AND m.org_id = p_org_id
  LIMIT 1;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_org_membership(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_org_membership(uuid, uuid) TO idenzy_app;

--> statement-breakpoint
-- The organisation switcher's list, and the first thing the panel asks for after a
-- sign-in. Ordered by when the person joined, so the switcher is stable across reloads.
CREATE OR REPLACE FUNCTION orgs_for_user(p_user_id uuid)
RETURNS TABLE (
  org_id uuid,
  name text,
  member_id uuid,
  role text,
  joined_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT o.id, o.name, m.id, m.role, m.created_at
  FROM public.org_members m
  JOIN public.orgs o ON o.id = m.org_id
  WHERE m.user_id = p_user_id
  ORDER BY m.created_at, o.id;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION orgs_for_user(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orgs_for_user(uuid) TO idenzy_app;
