-- The two activity readers answered one page and nothing after it.
--
-- Both ordered by id and stopped at a limit — 200 organisations for the drawdown, 500 projects for
-- the hourly roller — and both callers asked for the first page every pass and never the second.
-- So the 201st organisation by uuid was never charged by the drawdown's own pass, and the 501st
-- project never had an hour rolled. Nothing errored: the work simply never reached them, and the
-- set of organisations it never reached was decided by the random bytes of their ids.
--
-- Each now takes the last id of the previous page, so a caller can walk every page. The old
-- signatures are dropped rather than kept beside the new ones: a caller left on the one-page form
-- is exactly the bug, and a missing function fails loudly where a stale one would not.
--
-- DROP and CREATE rather than CREATE OR REPLACE, because the argument list changes; and the
-- REVOKE/GRANT pair is repeated, because privileges do not survive the drop (docs/guide/repo.md).

DROP FUNCTION public.orgs_with_recent_usage(p_since date, p_limit integer);
--> statement-breakpoint
CREATE FUNCTION public.orgs_with_recent_usage(p_since date, p_after uuid, p_limit integer)
RETURNS TABLE(org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT DISTINCT p.org_id
  FROM public.usage_daily d
  JOIN public.projects p ON p.id = d.project_id
  WHERE d.day >= p_since
    AND (p_after IS NULL OR p.org_id > p_after)
  ORDER BY p.org_id
  LIMIT p_limit;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.orgs_with_recent_usage(p_since date, p_after uuid, p_limit integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION public.orgs_with_recent_usage(p_since date, p_after uuid, p_limit integer) TO idenzy_app;
--> statement-breakpoint
DROP FUNCTION public.usage_projects_with_activity(since date, max_projects integer);
--> statement-breakpoint
CREATE FUNCTION public.usage_projects_with_activity(since date, after_project uuid, max_projects integer)
RETURNS TABLE(project_id uuid)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT d.project_id
  FROM usage_daily d
  WHERE d.day >= since
    AND (after_project IS NULL OR d.project_id > after_project)
  GROUP BY d.project_id
  ORDER BY d.project_id
  LIMIT max_projects;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.usage_projects_with_activity(since date, after_project uuid, max_projects integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION public.usage_projects_with_activity(since date, after_project uuid, max_projects integer) TO idenzy_app;
