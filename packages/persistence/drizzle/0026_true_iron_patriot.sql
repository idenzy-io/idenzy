-- FORCE RLS and grants for the four tables 0025 brought under a policy, and the reason
-- `orgs` is among them.
--
-- The two DO blocks below are the ones 0004 wrote down as mandatory after any migration
-- that puts a table under RLS. They are copied verbatim and are dynamic and idempotent,
-- so they need no edit to cover a new key: the first loops over every table with RLS
-- enabled and no FORCE, and the second grants on every table but `audit_events`. An
-- org-keyed table and a project-keyed one are the same shape to both.
--
-- `orgs` gained a policy in 0025 and therefore gains FORCE here. Two consequences are
-- worth stating rather than discovering.
--
-- First, `idenzy_app` can no longer read an organisation row outside an `app.org_id`
-- transaction. That is the point (ADR-0011), and it is what `UnitOfWork.runForOrg`
-- exists to give it.
--
-- Second, `idenzy_app` can no longer create one: the WITH CHECK compares the new row's
-- own id against a setting that is unset while the row does not exist yet, so the insert
-- is refused. `projects` has behaved exactly this way since 0000 for the same reason, and
-- the answer is the same — provisioning is not a runtime path and does not connect as the
-- runtime role. When it lands it gets a narrow SECURITY DEFINER function, the way
-- `resolve_project_by_host` did in 0002, rather than a hole in this policy.
--
-- `region_cells` and `staff_access_grants` are deliberately left alone. A cell registry
-- has no owner and a staff grant is about a member of our staff, not about a customer, so
-- neither has a key to be isolated on and both stay on `runGlobal`.

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
