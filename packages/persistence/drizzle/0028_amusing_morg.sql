-- FORCE RLS and grants for the seven tables 0027 added, and the one deliberate exception
-- among them.
--
-- Six of the seven are org-keyed and carry the policy from 0025's helper, so the first
-- block below picks them up the way it picks up any table with RLS enabled and no FORCE.
--
-- `payment_provider_events` is the exception and is not an oversight. A payment webhook
-- arrives for whichever organisation it happens to concern, and the handler receiving it
-- has none bound: mapping the provider's customer id to an organisation is the first
-- thing it does *with* the row, not something it can know before writing it. An
-- isolation policy would refuse every insert and hide every row, which is exactly the
-- quiet failure migration 0024 documents for the audit relay. `relay_offsets` is outside
-- RLS for the same shape of reason (0023).
--
-- What stands in for the policy is the unique index on (provider, provider_event_id).
-- The provider delivers at least once by design, so the insert is the idempotency check:
-- a second delivery collides and is dropped, and a handler that is not idempotent cannot
-- grant credit twice.
--
-- The privilege shape below is the narrowest that still works. The webhook receiver
-- inserts and the sweep marks a row processed, so SELECT, INSERT and UPDATE are granted
-- and DELETE is not. A payment event is evidence a disputed charge is reconciled against,
-- and nothing on the request path has a reason to remove one.

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
-- payment_provider_events is excluded for the narrower shape granted below it.
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
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO idenzy_app', t.relname
    );
  END LOOP;
END
$$;

--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_provider_events" TO idenzy_app;
