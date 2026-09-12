-- Hand-authored, for `webhook_endpoint_stats`, which 0040 added.
--
-- drizzle-kit emits the RLS policy and nothing else: not FORCE ROW LEVEL SECURITY, and not the
-- grant that lets idenzy_app read the table at all (ADR-0001, docs/guide/repo.md). Without both,
-- a new table is unreadable by the application and readable across tenants by its owner.
--
-- **Named, not looped, and that is a correction to how 0004 did it.** The dynamic blocks there
-- grant SELECT, INSERT, UPDATE and DELETE on every table except `audit_events`, and the schema now
-- has three that must refuse one of those verbs: every `audit_events_*` partition, which is
-- append-only and was narrowed in 0030, and `payment_provider_events`, which must never be
-- deleted from. Copying those blocks today silently re-grants all four on each of them — which is
-- exactly what the append-only tests in `packages/testing` caught when this migration was first
-- written as a copy. A grant for one new table names the table.
ALTER TABLE public.webhook_endpoint_stats FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_endpoint_stats TO idenzy_app;
