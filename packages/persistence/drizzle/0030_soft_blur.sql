-- The audit trail was not append-only, and the default privileges are why.
--
-- ADR-0003 and PROJECT.md 4.13.3 both claim that `idenzy_app` holds INSERT and SELECT on
-- `audit_events` and no UPDATE or DELETE grant at all, so no application code path can
-- rewrite history. Migration 0001 set that up correctly on the parent. It then ended with
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO idenzy_app;
--
-- and `audit_events` is partitioned. Every partition is a table created after that line
-- ran, so every partition was granted all four privileges the moment it came into
-- existence, and `ensure_audit_partition`'s own `GRANT SELECT, INSERT` was additive and
-- changed nothing. The parent refuses a delete; the partition underneath it does not:
--
--     DELETE FROM audit_events;             -- ERROR: permission denied
--     DELETE FROM audit_events_2026_09;     -- DELETE 1
--
-- A partition name is `audit_events_` and a month, so guessing one is not the hard part.
-- The hash chain still detects the removal after the fact, which is what it is for, but
-- the privilege shape that was supposed to make the removal impossible was not there.
--
-- The same mechanism silently undid the narrower grant 0028 intended for
-- `payment_provider_events`: that table was created in 0027, after the same line, so it
-- held DELETE before 0028 got the chance to withhold it.
--
-- Two fixes, because either alone leaves the trap set.

--> statement-breakpoint
-- 1. Stop the defaults re-granting the two verbs a migration may need to withhold ------
-- SELECT and INSERT stay: they are what an ordinary new table needs, and no table has
-- ever wanted to refuse them. UPDATE and DELETE are the ones an append-only table exists
-- to refuse, and a default privilege cannot be narrowed per table — it can only be
-- revoked afterwards by somebody who remembered, which is exactly the control ADR-0003
-- says not to rely on. Ordinary tables are unaffected: the mandatory grant block that
-- every new-table migration copies from 0004 still grants all four explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE UPDATE, DELETE ON TABLES FROM idenzy_app;

--> statement-breakpoint
-- 2. Repair the partitions that already exist ----------------------------------------
DO $$
DECLARE
  part record;
BEGIN
  FOR part IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE parent.relname = 'audit_events'
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON public.%I FROM idenzy_app', part.relname);
  END LOOP;
END
$$;

--> statement-breakpoint
-- 3. Make the partition maintainer defend itself --------------------------------------
-- The REVOKE is unconditional rather than conditional on the defaults, so this function
-- produces an append-only partition whatever the default privileges happen to say when
-- it runs. It is the single writer of these tables and is the right place for the
-- guarantee to live (PROJECT.md 4.13.3).
CREATE OR REPLACE FUNCTION ensure_audit_partition(target date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  start_at date := date_trunc('month', target)::date;
  end_at   date := (date_trunc('month', target) + interval '1 month')::date;
  name     text := format('audit_events_%s', to_char(start_at, 'YYYY_MM'));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
      name, start_at, end_at
    );
    EXECUTE format('GRANT SELECT, INSERT ON %I TO idenzy_app', name);
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM idenzy_app', name);
  END IF;
END
$$;

--> statement-breakpoint
-- 4. And the table 0028 meant to narrow ------------------------------------------------
REVOKE DELETE ON "payment_provider_events" FROM idenzy_app;
