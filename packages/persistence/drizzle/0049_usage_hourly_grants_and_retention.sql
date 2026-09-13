-- Hand-authored: `usage_hourly`'s grants, and the retention pass that makes three tiers true.
--
-- drizzle-kit emits the policy in 0048 and nothing else — not FORCE ROW LEVEL SECURITY and not the
-- grant — so without the first two statements the app role cannot read the table and the owner can
-- read across tenants. Named statements rather than the dynamic blocks from 0004, which grant all
-- four verbs on everything and would undo what 0046 withheld from `usage_periods`.
--
-- The rest of this file is the harder half. Three tiers were declared in the schema — six months of
-- hours, two years of days, six years of periods — and a tier nothing enforces is a sentence in a
-- data map rather than a fact about the database. This is what enforces them.
--
-- SECURITY DEFINER for a reason that is not convenience. A sweeper serves every project and sets no
-- `app.project_id`, so under FORCE RLS a direct delete matches nothing: no error, no rows, and three
-- tables that grow forever while a job reports success. And `usage_periods` holds no DELETE grant at
-- all, deliberately (0046) — retention is a system action and an application path that could remove
-- a closed billing period is exactly what that withholding exists to prevent. Running the deletion
-- as the owner keeps both properties: the app still cannot, and the sweeper still can.
--
-- Bounded by `max_rows` and reporting what it removed, so a first pass over a table that has been
-- accumulating for a year is a series of passes rather than one statement holding locks for minutes.
-- The cutoffs are parameters rather than constants in here, because the tiers are declared in the
-- schema with `classified()` and a second copy of them in SQL is a second place to be wrong.

--> statement-breakpoint
ALTER TABLE public.usage_hourly FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usage_hourly TO idenzy_app;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION usage_prune_hourly(older_than timestamptz, max_rows int)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed bigint;
BEGIN
  WITH doomed AS (
    SELECT project_id, hour FROM usage_hourly
    WHERE hour < older_than
    ORDER BY hour
    LIMIT max_rows
  )
  DELETE FROM usage_hourly u USING doomed d
  WHERE u.project_id = d.project_id AND u.hour = d.hour;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION usage_prune_daily(older_than date, max_rows int)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed bigint;
BEGIN
  WITH doomed AS (
    SELECT project_id, day FROM usage_daily
    WHERE day < older_than
    ORDER BY day
    LIMIT max_rows
  )
  DELETE FROM usage_daily u USING doomed d
  WHERE u.project_id = d.project_id AND u.day = d.day;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION usage_prune_periods(older_than date, max_rows int)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed bigint;
BEGIN
  WITH doomed AS (
    SELECT project_id, period FROM usage_periods
    WHERE period < older_than
    ORDER BY period
    LIMIT max_rows
  )
  DELETE FROM usage_periods u USING doomed d
  WHERE u.project_id = d.project_id AND u.period = d.period;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION usage_prune_hourly(timestamptz, int) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION usage_prune_daily(date, int) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION usage_prune_periods(date, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION usage_prune_hourly(timestamptz, int) TO idenzy_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION usage_prune_daily(date, int) TO idenzy_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION usage_prune_periods(date, int) TO idenzy_app;
