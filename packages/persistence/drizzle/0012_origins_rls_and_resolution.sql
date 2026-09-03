-- Two jobs: the usual FORCE RLS and grants for the tenant table added in 0011, and a
-- rebuild of both resolution functions so tenant resolution and CORS share one lookup.
--
-- The rebuild is a DROP and CREATE rather than a CREATE OR REPLACE, and that is forced:
-- Postgres will not let CREATE OR REPLACE FUNCTION change a return type, and both functions
-- gain two output columns here. The consequence that bites is that privileges do not survive
-- a DROP, so the REVOKE and GRANT from migration 0002 have to be repeated below. Without them
-- the functions exist, EXECUTE falls back to PUBLIC, and idenzy_app loses the only lookup it
-- has for turning a Host header into a project.

--> statement-breakpoint
-- 1. FORCE ROW LEVEL SECURITY --------------------------------------------------------
-- Without FORCE, the table owner bypasses its own policies (PROJECT.md 4.10).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END
$$;

--> statement-breakpoint
-- 2. Grants --------------------------------------------------------------------------
-- audit_events is excluded because its privilege shape is append-only and is set in
-- 0001; granting UPDATE or DELETE on it here would silently undo that (PROJECT.md 4.13.3).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'audit_events'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO idenzy_app', t.relname
    );
  END LOOP;
END
$$;

--> statement-breakpoint
-- 3. Resolution functions, rebuilt ---------------------------------------------------
-- Both gain allowed_origins, so the CORS layer does not need a second query on the hot
-- path, and has_auth_domain, which is what tells cookie mode whether it can work at all:
-- a __Host- cookie is only sent to the host that set it, so it is useless unless the auth
-- API is same-site with the customer's app (PROJECT.md 4.3).
--
-- Still no personal data, which is the promise migration 0002 makes and this one keeps.
DROP FUNCTION IF EXISTS resolve_project_by_host(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS resolve_project_by_key_hash(text);

--> statement-breakpoint
CREATE FUNCTION resolve_project_by_host(p_host text)
RETURNS TABLE (
  project_id uuid, cell_id uuid, compliance_tier text, plan text,
  allowed_origins text[], has_auth_domain boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function that resolves unqualified names
-- through the caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  SELECT p.id, p.cell_id, p.compliance_tier, p.plan,
         COALESCE(ARRAY(SELECT o.origin FROM public.project_origins o WHERE o.project_id = p.id),
                  '{}'::text[]),
         true
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
CREATE FUNCTION resolve_project_by_key_hash(p_hash text)
RETURNS TABLE (
  project_id uuid, cell_id uuid, compliance_tier text, plan text,
  key_kind text, scopes text[], allowed_origins text[], has_auth_domain boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p.id, p.cell_id, p.compliance_tier, p.plan, k.kind, k.scopes,
         COALESCE(ARRAY(SELECT o.origin FROM public.project_origins o WHERE o.project_id = p.id),
                  '{}'::text[]),
         EXISTS (SELECT 1 FROM public.project_domains d
                 WHERE d.project_id = p.id AND d.type = 'auth' AND d.status = 'verified')
  FROM public.api_keys k
  JOIN public.projects p ON p.id = k.project_id
  WHERE k.hash = p_hash
    AND k.revoked_at IS NULL
  LIMIT 1;
$$;

--> statement-breakpoint
-- Re-granted because the DROP above took the 0002 privileges with it.
REVOKE ALL ON FUNCTION resolve_project_by_host(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_project_by_key_hash(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_project_by_host(text) TO idenzy_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_project_by_key_hash(text) TO idenzy_app;
