-- FORCE RLS and grants for the three tables 0054 added (ADR-0014).
--
-- Named one at a time rather than by looping over the catalogue. The dynamic blocks in
-- 0004 grant all four verbs on every table they find, which re-grants what 0001 and 0030
-- deliberately withheld from `audit_events` and what 0028 withheld from
-- `payment_provider_events` — the trap `docs/guide/repo.md` records and the append-only
-- tests caught once already.
--
-- Two privilege shapes here, and the difference is the point.
--
-- `usage_billing_state` and `org_debts` are *state*: a watermark that advances and a figure
-- that moves both ways as usage is charged and credit is added. They need UPDATE, which is
-- the whole mechanism — the drawdown advances the watermark by compare-and-swap on the
-- value it read, so a pass that lost a race matches no row rather than overwriting a
-- concurrent one. Neither gets DELETE: they are the financial position of an organisation,
-- and retention for them is a sweeper's job through a SECURITY DEFINER function, the way
-- `usage_periods` is pruned.
--
-- `usage_charges` is the *record* underneath both, and it is append-only. SELECT and INSERT
-- only. `org_debts.debt_cents` is a materialised total and this is what it can be rebuilt
-- from when a customer disputes a figure; a ledger somebody could amend afterwards is not
-- evidence of anything, which is the same argument 0001 makes for the audit trail.

--> statement-breakpoint
ALTER TABLE public.usage_billing_state FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.org_debts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.usage_charges FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.usage_billing_state TO idenzy_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.org_debts TO idenzy_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.usage_charges TO idenzy_app;

--> statement-breakpoint
-- The drawdown runs in `apps/workers` and serves every organisation, so it binds no
-- `app.org_id` and the policies above would hide every row from it — the silent failure
-- 0024 records for the audit relay and 0049 for the retention sweep. It needs two answers
-- that cross tenants and nothing else: which organisations have had usage recently, and
-- what a project's month came to.
--
-- Narrow on purpose: it takes no argument that selects an organisation and returns nothing
-- but ids, so it cannot be used to read one organisation's figures while acting for
-- another. What the drawdown then does with each id is ordinary and scoped — the
-- organisation's projects under `app.org_id`, and each project's own days under
-- `app.project_id`, exactly as the usage closer already does it.
--
-- There is deliberately no SQL function here that counts a month. `usage_daily.mau_hll` is
-- a `bytea` holding a sketch this codebase serialises itself, not a Postgres `hll` type, so
-- there is nothing in the database that can union two of them or read a cardinality off
-- one. The union happens in TypeScript, which is also where the rule that makes it correct
-- lives: sketches are unioned within a project, across its days, and only the resulting
-- counts are added across projects.
CREATE OR REPLACE FUNCTION orgs_with_recent_usage(p_since date, p_limit integer)
RETURNS TABLE (org_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function resolving unqualified names through the
-- caller's search_path is a privilege-escalation vector.
SET search_path = ''
AS $$
  SELECT DISTINCT p.org_id
  FROM public.usage_daily d
  JOIN public.projects p ON p.id = d.project_id
  WHERE d.day >= p_since
  ORDER BY p.org_id
  LIMIT p_limit;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION orgs_with_recent_usage(date, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orgs_with_recent_usage(date, integer) TO idenzy_app;
