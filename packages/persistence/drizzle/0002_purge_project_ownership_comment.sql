-- `purge_project` described the wrong thing as the control.
--
-- Its own body said the ownership check was a backstop: SECURITY DEFINER runs outside RLS, so
-- the policy that would otherwise stop one organisation naming another's project does not apply
-- inside the body, and this re-check holds if anything calls the function directly. That was
-- true while there were policies. There are none, so the `IF NOT EXISTS` below is not the
-- second line behind anything — it is the only thing standing between an org id and another
-- customer's project, on the one function in the schema that deletes a trail.
--
-- Nothing executable changes. The body is byte-identical but for the comment, and a comment on
-- a security boundary that names a control which no longer exists is worth a migration on its
-- own: the next person to read this function is deciding whether the check may be relaxed.
CREATE OR REPLACE FUNCTION public.purge_project(p_org_id uuid, p_project_id uuid, p_purged_by text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  removed int;
BEGIN
  -- Ownership is re-checked here and not taken on trust, and this is the whole check. SECURITY
  -- DEFINER runs as the owner, so nothing underneath narrows what this body can reach: without
  -- the test below, any org id paired with any project id would purge it. ProjectScope makes
  -- the same check a layer up, which is defence in depth rather than the reason this one exists.
  IF NOT EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND org_id = p_org_id
  ) THEN
    -- Null rather than an exception: "not yours" and "not there" answer the same way, so a
    -- caller cannot use this to discover that a project id is real.
    RETURN NULL;
  END IF;

  DELETE FROM audit_events WHERE project_id = p_project_id;
  GET DIAGNOSTICS removed = ROW_COUNT;

  -- The foreign-key cascade empties the other 39 tables. One statement, one transaction with
  -- the audit delete above, so a purge cannot half-happen and leave a project whose trail is
  -- gone.
  DELETE FROM projects WHERE id = p_project_id;

  INSERT INTO project_purges (project_id, org_id, audit_rows_deleted, purged_by)
  VALUES (p_project_id, p_org_id, removed, p_purged_by);

  RETURN removed;
END;
$$;
