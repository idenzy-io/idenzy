-- FORCE RLS and grants for the two tables added in 0018.
--
-- drizzle-kit emits the policy and nothing else (ADR-0001), so without this migration
-- mfa_challenges and mfa_recovery_codes would each have a tenant policy the owner
-- bypasses and no privileges at all for idenzy_app.
--
-- The direction of that failure is worth naming, because it is not the usual one. A
-- table idenzy_app cannot read looks empty, and an empty mfa_recovery_codes means every
-- recovery code a user holds is refused: somebody who has already lost their phone would
-- find their last way in gone. An unreadable mfa_challenges is louder and less dangerous,
-- since no second factor could be answered at all.
--
-- The blocks are copied from 0004 unchanged. They are dynamic and idempotent on purpose,
-- so the next migration that adds a tenant table copies them again rather than editing a
-- list that somebody will forget to extend.

--> statement-breakpoint
-- 1. FORCE ROW LEVEL SECURITY --------------------------------------------------------
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
