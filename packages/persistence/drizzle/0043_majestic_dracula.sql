-- Hand-authored: the one cross-tenant read the webhook sweeper needs (ADR-0012).
--
-- The sweeper is the durable half of the pipeline. Cloud Tasks holds a `scheduleTime` and calls the
-- dispatcher at it; a task that was never created, or a dispatcher that died holding a delivery,
-- leaves a row on the table that only a scan will find. That scan is per project — `claimDue` is
-- tenant-scoped like everything else — so something has to answer which projects have work.
--
-- It cannot be a repository. Those are scoped by `app.project_id` and a sweeper serving every
-- project has none, so a direct read comes back empty under FORCE RLS: no error, no deliveries, and
-- a queue that looks idle while it fills. The same reason the audit relay reads the outbox through a
-- function (0023), and the same narrowing: this one returns project ids and nothing else, so it
-- cannot become a way to read one customer's deliveries from another's connection.
--
-- The order is by how overdue the work is, so a sweep that hits its cap takes the projects that have
-- been waiting longest rather than whichever the planner happened to reach.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION webhook_projects_with_due_deliveries(due_before timestamptz, max_projects int)
RETURNS TABLE (project_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.project_id
  FROM webhook_deliveries d
  WHERE d.status IN ('queued', 'delivering')
    AND d.next_attempt_at IS NOT NULL
    AND d.next_attempt_at <= due_before
  GROUP BY d.project_id
  ORDER BY min(d.next_attempt_at)
  LIMIT max_projects;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION webhook_projects_with_due_deliveries(timestamptz, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION webhook_projects_with_due_deliveries(timestamptz, int) TO idenzy_app;
