-- Hand-authored, and the reason it exists is worth reading before the next table lands.
--
-- Migration 0001 applied FORCE ROW LEVEL SECURITY and the baseline grants by looping
-- over every table that existed at the time. It ran once. The tables added in 0003
-- (verification_tokens, email_change_requests, auth_codes) therefore have their policy
-- from drizzle-kit but neither FORCE nor a grant, which means idenzy_app cannot read
-- them at all and the owner could read across tenants.
--
-- So: any migration that adds a tenant table must be followed by these two blocks. They
-- are dynamic and idempotent, so re-running them costs nothing and missing them costs
-- tenant isolation. There is no way to make drizzle-kit emit them (ADR-0001).

--> statement-breakpoint
-- 1. FORCE ROW LEVEL SECURITY --------------------------------------------------------
-- Without FORCE, the table owner bypasses its own policies. Ownership must not be an
-- escape hatch (PROJECT.md 4.10).
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
