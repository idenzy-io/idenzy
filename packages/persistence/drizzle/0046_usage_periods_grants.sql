-- Hand-authored: FORCE RLS and the deliberately narrow grant for `usage_periods`.
--
-- drizzle-kit emits the policy in 0045 and nothing else — not FORCE ROW LEVEL SECURITY, and not
-- the grant — so without this the app role cannot read the table at all and the table owner can
-- read across tenants. Named statements rather than the dynamic blocks copied from 0004, which
-- grant all four verbs on everything and would undo the withholding below.
--
-- SELECT and INSERT only, on purpose. A closed billing period is the figure an invoice is raised
-- from, so nothing on the request path has a reason to amend or remove one — the same shape
-- `payment_provider_events` has for the same reason, and the shape `audit_events` has because a
-- record that can be rewritten is not a record. A period is written once, when its month is over
-- and its sketches are dropped, and there is nothing afterwards that could be corrected without
-- also being a decision somebody makes deliberately as the owner.
--
-- Since 0030 the default privileges grant SELECT and INSERT only, so the two absent verbs are
-- absent by inheritance as well as by intent. They are granted explicitly here anyway, because a
-- grant that depends on a default nobody can see from this file is the class of bug 0030 exists
-- to describe. The absence is asserted in `tenancy.integration.test.ts`, which is the only place
-- it can be: the grants test checks that privileges are present and cannot see this.

--> statement-breakpoint
ALTER TABLE public.usage_periods FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
GRANT SELECT, INSERT ON public.usage_periods TO idenzy_app;
