-- FORCE RLS, grants and the cross-tenant reads for the three tables 0056 added
-- (risks.md 2 and 2b, PROJECT.md 11.2 item 4).
--
-- Named one at a time rather than by looping over the catalogue, for the reason
-- `docs/guide/repo.md` records: the dynamic blocks in 0004 grant all four verbs on every
-- table they find, which re-grants what 0001 and 0030 withheld from `audit_events` and what
-- 0028 withheld from `payment_provider_events`.
--
-- **None of the three gets DELETE**, and each withholds it for its own reason.
--
-- `email_delivery_stats` is a counter that ages out on a tier, so removing a row is a
-- retention action and belongs to a sweeper through a SECURITY DEFINER function — the same
-- shape as `usage_daily` in 0049, and for the same reason: a sweeper serves every project
-- and binds no `app.project_id`, so a tenant-scoped delete would match nothing, report
-- success, and leave the table growing forever.
--
-- `email_sending_holds` is a record of a decision. A release sets `released_at` and keeps the
-- row, so what was blocked, on what evidence and who undid it outlives the block. An
-- application path that could delete one is exactly what a customer disputing a stopped send
-- would need it not to have.
--
-- `email_provider_events` is the idempotency ledger, and a row somebody could remove is a
-- redelivered bounce that gets counted twice.

--> statement-breakpoint
ALTER TABLE public.email_delivery_stats FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.email_sending_holds FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.email_delivery_stats TO idenzy_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.email_sending_holds TO idenzy_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.email_provider_events TO idenzy_app;

--> statement-breakpoint
-- Which projects the breaker in `apps/workers` has to look at.
--
-- The breaker serves every project and binds no `app.project_id`, so the isolation policy
-- above would hide every row from it — the silent failure 0024 records for the audit relay
-- and 0049 for the retention sweep.
--
-- **The union is the whole of it, and the second half is not an optimisation.** A project
-- with recent delivery events might need holding. A project with an *open hold* has stopped
-- sending by definition, so it stops producing delivery events, so it falls out of the first
-- half within a window — and a breaker that only read the first half could open a hold and
-- then never be able to release one. Held forever, over a week that has long since rolled
-- past, with no way back that does not involve a person and a SQL prompt.
--
-- Narrow on purpose: it takes no argument that selects a project and returns nothing but
-- ids, so it cannot be turned into a way to read one project's figures while acting for
-- another. What the breaker does with each id afterwards is ordinary and scoped, under
-- `app.project_id`, exactly as the usage roller already does it.
CREATE OR REPLACE FUNCTION projects_for_email_reputation(p_since date, p_limit integer)
RETURNS TABLE (project_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function resolving unqualified names through the
-- caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  SELECT project_id FROM (
    SELECT DISTINCT s.project_id
    FROM public.email_delivery_stats s
    WHERE s.day >= p_since
    UNION
    SELECT h.project_id
    FROM public.email_sending_holds h
    WHERE h.released_at IS NULL
  ) AS candidates
  ORDER BY project_id
  LIMIT p_limit;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION projects_for_email_reputation(date, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION projects_for_email_reputation(date, integer) TO idenzy_app;

--> statement-breakpoint
-- Retention, bounded per call so the first pass over an accumulated table is a series of
-- passes rather than one statement holding locks for minutes. Both mirror `usage_prune_daily`
-- from 0049 down to the `GET DIAGNOSTICS`, because what they are is the same thing.
CREATE OR REPLACE FUNCTION email_prune_delivery_stats(older_than date, max_rows int)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed bigint;
BEGIN
  WITH doomed AS (
    SELECT project_id, day FROM email_delivery_stats
    WHERE day < older_than
    ORDER BY day
    LIMIT max_rows
  )
  DELETE FROM email_delivery_stats s USING doomed d
  WHERE s.project_id = d.project_id AND s.day = d.day;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION email_prune_provider_events(older_than timestamptz, max_rows int)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed bigint;
BEGIN
  WITH doomed AS (
    SELECT id FROM email_provider_events
    WHERE received_at < older_than
    ORDER BY received_at
    LIMIT max_rows
  )
  DELETE FROM email_provider_events e USING doomed d
  WHERE e.id = d.id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION email_prune_delivery_stats(date, int) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION email_prune_provider_events(timestamptz, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION email_prune_delivery_stats(date, int) TO idenzy_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION email_prune_provider_events(timestamptz, int) TO idenzy_app;
