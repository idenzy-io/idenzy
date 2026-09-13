-- Hand-authored: the one cross-tenant read the usage period closer needs (PROJECT.md 5.1).
--
-- Closing a month is per project — `dailyBetween`, `freezeDays` and the period insert are all
-- tenant-scoped like everything else — so something has to answer which project-months are ready
-- to be shut. A worker serving every project sets no `app.project_id`, so a direct read comes back
-- empty under FORCE RLS: no error, no work, and periods that are never closed while the sketches
-- behind them accumulate forever. Same reason and same narrowing as `webhook_projects_with_due_-
-- deliveries` (0043) and the audit relay's outbox reader (0023): it returns a project id and a
-- month and nothing else, so it cannot become a way to read one customer's usage from another's
-- connection.
--
-- `NOT EXISTS` against `usage_periods` rather than "has a sketch left" is deliberate. A month in
-- which nobody was billable but email was sent has no sketch to look for and still owes a period
-- row, because the counters on it are what the invoice is raised from too.
--
-- The grouping is a CTE rather than a `HAVING NOT EXISTS`, which is not a style choice: a
-- correlated subquery in `HAVING` may only reference grouped columns, and `date_trunc('month',
-- d.day)` inside one reads `d.day` ungrouped. Postgres refuses it outright.
--
-- Ordered oldest month first so a backlog is worked through in the order the invoices are owed,
-- and capped because a pass is a pass: the next one is a few minutes away.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION usage_closable_periods(before_period date, max_periods int)
RETURNS TABLE (project_id uuid, period date)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH months AS (
    SELECT d.project_id AS project_id, date_trunc('month', d.day)::date AS period
    FROM usage_daily d
    WHERE d.day < before_period
    GROUP BY 1, 2
  )
  SELECT m.project_id, m.period
  FROM months m
  WHERE NOT EXISTS (
    SELECT 1 FROM usage_periods p
    WHERE p.project_id = m.project_id AND p.period = m.period
  )
  ORDER BY m.period, m.project_id
  LIMIT max_periods;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION usage_closable_periods(date, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION usage_closable_periods(date, int) TO idenzy_app;
