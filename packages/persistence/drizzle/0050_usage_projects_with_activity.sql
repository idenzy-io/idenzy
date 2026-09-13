-- Hand-authored: which projects the hourly roller has to visit (PROJECT.md 5.1).
--
-- Rolling an hour up is per project — the sketches are unioned inside the project's own tenant
-- scope — so something has to answer which projects had any activity to roll. A worker serving
-- every project sets no `app.project_id`, so a direct read of `usage_daily` comes back empty under
-- FORCE RLS: no error, no work, and an hourly series that is permanently blank. The same reason and
-- the same narrowing as `usage_closable_periods` (0047) and the two functions before it — a project
-- id and nothing else.
--
-- "Activity" is a `usage_daily` row on or after `since`, which is the roller's own lookback. A
-- project with nothing to count has no row at all, so it is absent from this list rather than being
-- visited to write a row of zeroes every hour for the life of the account.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION usage_projects_with_activity(since date, max_projects int)
RETURNS TABLE (project_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.project_id
  FROM usage_daily d
  WHERE d.day >= since
  GROUP BY d.project_id
  ORDER BY d.project_id
  LIMIT max_projects;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION usage_projects_with_activity(date, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION usage_projects_with_activity(date, int) TO idenzy_app;
