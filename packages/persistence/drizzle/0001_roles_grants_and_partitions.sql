-- Hand-authored. drizzle-kit generates none of this (ADR-0001):
--   1. FORCE ROW LEVEL SECURITY
--   2. grants, including the append-only privilege shape of audit_events
--   3. table partitioning
--
-- Roles are NOT created here. They are cluster-level objects created by provisioning
-- (infra/docker/postgres-init locally, Terraform on Cloud SQL), because migration 0000
-- already references idenzy_app in its CREATE POLICY statements and therefore cannot
-- run on a cluster where the role does not yet exist.
--
-- Everything here is idempotent, so re-running is safe.

--> statement-breakpoint
-- 1. FORCE ROW LEVEL SECURITY on every RLS table -------------------------------------
-- Without FORCE, the table owner bypasses its own policies. Ownership must not be an
-- escape hatch (PROJECT.md 4.10).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END
$$;

--> statement-breakpoint
-- 2. Baseline grants -----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO idenzy_app;

--> statement-breakpoint
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'audit_events'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO idenzy_app', t.relname
    );
  END LOOP;
END
$$;

--> statement-breakpoint
-- 3. audit_events: append-only and partitioned ---------------------------------------
-- Recreated as a partitioned table because drizzle-kit created it as a plain one and a
-- table cannot be partitioned after the fact. Safe here only because Phase 0 has no
-- data; any later change to this table is an expand/contract migration.
DROP TABLE IF EXISTS "audit_events" CASCADE;

--> statement-breakpoint
CREATE TABLE "audit_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "action" text NOT NULL,
  "target" text,
  "ip" text,
  "ua" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "prev_hash" text NOT NULL,
  "entry_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

--> statement-breakpoint
CREATE INDEX "audit_events_project_created_idx" ON "audit_events" ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_events_project_actor_idx" ON "audit_events" ("project_id", "actor_id");

--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY "audit_events_tenant_isolation" ON "audit_events"
  AS PERMISSIVE FOR ALL TO "idenzy_app"
  USING (project_id = nullif(current_setting('app.project_id', true), '')::uuid)
  WITH CHECK (project_id = nullif(current_setting('app.project_id', true), '')::uuid);

--> statement-breakpoint
-- THE integrity control (PROJECT.md 4.13.3). INSERT and SELECT only: there is no UPDATE
-- or DELETE privilege on the connection, so no application code path can rewrite
-- history. The RLS policy above is only the tenant filter, not this guarantee.
REVOKE ALL ON "audit_events" FROM idenzy_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_events" TO idenzy_app;

--> statement-breakpoint
-- Monthly partitions, so retention is a DROP PARTITION rather than a mass delete.
CREATE OR REPLACE FUNCTION ensure_audit_partition(target date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  start_at date := date_trunc('month', target)::date;
  end_at   date := (date_trunc('month', target) + interval '1 month')::date;
  name     text := format('audit_events_%s', to_char(start_at, 'YYYY_MM'));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF audit_events FOR VALUES FROM (%L) TO (%L)',
      name, start_at, end_at
    );
    EXECUTE format('GRANT SELECT, INSERT ON %I TO idenzy_app', name);
  END IF;
END
$$;

--> statement-breakpoint
-- Current month and the next two, so a deploy never lands without a target partition.
SELECT ensure_audit_partition(CURRENT_DATE);
--> statement-breakpoint
SELECT ensure_audit_partition((CURRENT_DATE + interval '1 month')::date);
--> statement-breakpoint
SELECT ensure_audit_partition((CURRENT_DATE + interval '2 months')::date);

--> statement-breakpoint
-- 4. Future tables inherit the same grants -------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO idenzy_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO idenzy_app;
