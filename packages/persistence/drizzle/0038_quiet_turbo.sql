-- FORCE RLS and grants for the table 0037 added, plus a note on the policy beside it.
--
-- `projects` gained a second permissive policy in 0037, and permissive policies OR
-- together. That is the point rather than a side effect: the table is reached from two
-- planes and both readings are legitimate. auth-api arrives with one project bound and
-- must see exactly that row; the panel arrives with an organisation bound and must see
-- the projects it owns, which the original policy cannot express because it is keyed on a
-- project id the caller does not have yet.
--
-- It does not widen anything. With `app.project_id` set and `app.org_id` unset the new
-- clause is `org_id = NULL`, which matches nothing, so auth-api sees exactly what it saw
-- before. With `app.org_id` set the WITH CHECK ties a new project's `org_id` to the bound
-- organisation, which is what lets an organisation add a second project and stops it
-- adding one to anybody else's.
--
-- Provisioning needs no SECURITY DEFINER function, unlike every other place this schema
-- reaches past a policy, and it is worth saying why it does not. `UnitOfWork.provision`
-- generates an organisation id, binds it, and inserts `orgs`, `org_members` and
-- `projects` against it. Every WITH CHECK is satisfied by rows the transaction is
-- creating, nothing reads across tenants, and nothing writes outside the organisation it
-- just made. The policies hold as written. The safety of it rests entirely on that id
-- being generated rather than accepted: a caller who could choose what `app.org_id` binds
-- to could bind somebody else's and make themselves its owner, which is why there is no
-- parameter for it.

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
-- audit_events and its partitions keep the append-only shape set in 0001 and repaired in
-- 0030; payment_provider_events keeps the narrower one from 0028.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN ('audit_events', 'payment_provider_events')
      AND c.relname NOT LIKE 'audit\_events\_%'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO idenzy_app', t.relname
    );
  END LOOP;
END
$$;
