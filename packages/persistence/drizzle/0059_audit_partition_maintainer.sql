-- Keep audit partitions ahead of the clock (PROJECT.md 4.13.3).
--
-- 0001 created the current month and the next two and left it there. Nothing has called
-- `ensure_audit_partition` since, so roughly three months after any deploy every insert into
-- `audit_events` fails with "no partition of relation found for row". That is not a degradation
-- to absorb: an authentication request that cannot write its audit row is precisely the event
-- the trail exists to hold, and the failure is silent to everyone except the request it kills.
--
-- `ensure_audit_partition` itself cannot be the fix. It runs `CREATE TABLE` and two `GRANT`s,
-- and `idenzy_app` holds only USAGE on the schema (0001:34) and owns nothing, so the app role
-- calling it fails three ways. Granting the app role CREATE on the schema to make it work would
-- hand every connection the right to make tables — a much larger privilege than the problem.
--
-- So: a SECURITY DEFINER wrapper, the same shape as the 0052 sweepers. `ensure_audit_partition`
-- stays owner-only and ungranted; this is the one entry point the worker may call, it takes a
-- bounded horizon rather than a date, and it can create nothing but a partition of one table.
CREATE OR REPLACE FUNCTION ensure_audit_partitions_ahead(p_months int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created int := 0;
  horizon int := least(greatest(coalesce(p_months, 3), 1), 12);
  target  date;
  name    text;
  i       int;
BEGIN
  -- From the current month outwards, so a cold start with no partitions repairs itself
  -- rather than only covering the future and still failing on today's inserts.
  FOR i IN 0..horizon LOOP
    target := (date_trunc('month', CURRENT_DATE) + make_interval(months => i))::date;
    name   := format('audit_events_%s', to_char(target, 'YYYY_MM'));

    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = name) THEN
      -- Two workers starting together both see the gap and both try to fill it. The loser
      -- gets duplicate_table, which is the desired state arriving by another route, not an
      -- error worth failing a maintenance pass over.
      BEGIN
        PERFORM ensure_audit_partition(target);
        created := created + 1;
      EXCEPTION
        WHEN duplicate_table THEN NULL;
      END;
    END IF;
  END LOOP;

  RETURN created;
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION ensure_audit_partitions_ahead(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ensure_audit_partitions_ahead(int) TO idenzy_app;
--> statement-breakpoint
-- Close the gap this migration exists for, rather than waiting for a worker to boot.
SELECT ensure_audit_partitions_ahead(3);
