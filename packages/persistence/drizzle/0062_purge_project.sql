-- Deleting a project actually deletes it (GDPR Art. 28(3)(g)).
--
-- 0060 gave every tenant table a cascade, which covers 37 of the 38. `audit_events` cannot have
-- one: it is partitioned, and `idenzy_app` holds SELECT and INSERT on it and nothing else. That
-- revoke is not an oversight to work around — it is the integrity control of PROJECT.md 4.13.3,
-- and a cascade would have no privilege to fire even if partitioning allowed it.
--
-- Leaving the trail standing was the other option and it is not the conservative one. Idenzy is a
-- processor for end-user data, so at the end of provision of services it must delete the
-- controller's personal data unless law requires otherwise, and nothing obliges an authentication
-- provider to keep a customer's end-user security logs. An orphaned trail nobody can reach is a
-- storage-limitation breach (Art. 5(1)(e)) wearing the costume of caution.
--
-- So: one function, narrowly scoped, and the narrowing is what keeps 4.13.3 true. It cannot
-- touch a live project's history — the only rows it can remove belong to a project it deletes in
-- the same statement — so the property that matters, that nobody can quietly rewrite a tenant's
-- past to hide something, is untouched. What changes is that "no application code path can
-- delete an audit row" becomes "none except a project purge, which leaves a record of itself".
CREATE OR REPLACE FUNCTION purge_project(p_org_id uuid, p_project_id uuid, p_purged_by text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed int;
BEGIN
  -- Ownership is re-checked here and not taken on trust. SECURITY DEFINER runs outside RLS, so
  -- the policy that would otherwise stop one organisation naming another's project does not
  -- apply inside this body. ProjectScope makes the same check a layer up; this is the one that
  -- holds if anything ever calls the function directly.
  IF NOT EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND org_id = p_org_id
  ) THEN
    -- Null rather than an exception: "not yours" and "not there" answer the same way, so a
    -- caller cannot use this to discover that a project id is real.
    RETURN NULL;
  END IF;

  DELETE FROM audit_events WHERE project_id = p_project_id;
  GET DIAGNOSTICS removed = ROW_COUNT;

  -- The cascade from 0060 empties the other 37 tables. One statement, one transaction with the
  -- audit delete above, so a purge cannot half-happen and leave a project whose trail is gone.
  DELETE FROM projects WHERE id = p_project_id;

  INSERT INTO project_purges (project_id, org_id, audit_rows_deleted, purged_by)
  VALUES (p_project_id, p_org_id, removed, p_purged_by);

  RETURN removed;
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_project(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_project(uuid, uuid, text) TO idenzy_app;
--> statement-breakpoint
-- `project_purges` is named rather than swept up by a loop, per docs/guide/repo.md.
--
-- The app role gets nothing at all, which is deliberate and is the narrowest thing that works:
-- the row is written by the function above running as the owner, and its reader is an auditor or
-- an operator, not a request. A tenant-facing read would need a tenant to scope it to, and the
-- whole point of the row is that the tenant is gone. A control-plane surface for it belongs with
-- the plane split (4.13.5), not here.
REVOKE ALL ON "project_purges" FROM idenzy_app;
