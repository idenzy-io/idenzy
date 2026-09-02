-- Tenant resolution is a chicken-and-egg problem.
--
-- Every tenant table is protected by RLS keyed on current_setting('app.project_id'),
-- but resolving which project a request belongs to happens BEFORE that value is known.
-- The lookup by Host header or API key therefore cannot run under tenant scope, and
-- under RLS it would correctly return nothing.
--
-- The narrow fix is a SECURITY DEFINER function owned by idenzy_owner: it bypasses RLS
-- for exactly this one lookup and returns only what routing needs. The alternatives are
-- worse. A second role with broad read on projects widens the blast radius of a leaked
-- credential; disabling RLS on projects removes the isolation entirely.
--
-- These functions return no personal data, only routing and configuration.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION resolve_project_by_host(p_host text)
RETURNS TABLE (project_id uuid, cell_id uuid, compliance_tier text, plan text)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function that resolves unqualified names
-- through the caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  SELECT p.id, p.cell_id, p.compliance_tier, p.plan
  FROM public.projects p
  JOIN public.project_domains d ON d.project_id = p.id
  WHERE d.domain = p_host
    AND d.type = 'auth'
    AND d.status = 'verified'
  LIMIT 1;
$$;

--> statement-breakpoint
-- Takes the hash, never the key: the caller hashes, so a plaintext key never reaches
-- the database, its logs, or a pg_stat_statements entry.
CREATE OR REPLACE FUNCTION resolve_project_by_key_hash(p_hash text)
RETURNS TABLE (project_id uuid, cell_id uuid, compliance_tier text, plan text, key_kind text, scopes text[])
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p.id, p.cell_id, p.compliance_tier, p.plan, k.kind, k.scopes
  FROM public.api_keys k
  JOIN public.projects p ON p.id = k.project_id
  WHERE k.hash = p_hash
    AND k.revoked_at IS NULL
  LIMIT 1;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_project_by_host(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_project_by_key_hash(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_project_by_host(text) TO idenzy_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_project_by_key_hash(text) TO idenzy_app;
