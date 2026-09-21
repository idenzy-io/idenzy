-- Hand-authored, and the companion to the baseline (ADR-0001).
--
-- drizzle-kit generates tables, indexes and foreign keys from `src/schema`. It generates
-- none of what is below, so none of it can be reconstructed from the TypeScript: grants,
-- table partitioning, and the SECURITY DEFINER functions the application calls instead of
-- being given the privileges they need.
--
-- This replaces the sixty-nine migrations that preceded the collapse to one API and one
-- database. They are gone rather than superseded, because no deployment of this schema
-- exists to migrate forward: the pre-collapse migrations carried region cells and
-- fifty-six row-level-security policies that 0069 spent its whole length undoing, and
-- replaying a create-then-drop pair on every new database is a cost with no reader.
--
-- What is here was read back out of the database the old sequence produced, so the two
-- schemas are the same schema. `docs/guide/repo.md` records the check.
--> statement-breakpoint
-- 1. Schema ---------------------------------------------------------------------------
-- `idenzy_app` owns nothing and may create nothing. USAGE is the whole of its right to
-- the schema; every table and function it touches is granted one at a time below.
GRANT USAGE ON SCHEMA public TO idenzy_app;
--> statement-breakpoint
-- 2. audit_events, partitioned and append-only -----------------------------------------
-- Partitioned by month so retention is a DROP of one partition rather than a delete of
-- millions of rows, and because a table cannot be partitioned after it holds data. The
-- baseline does not create this table: the schema declaration it is generated from cannot
-- express `PARTITION BY`, so the definition lives here and the generated migration leaves
-- the name alone.
--
-- The primary key carries `created_at` because a partitioned table's key must contain its
-- partition key. `seq` is what actually orders the chain — `created_at` ties at
-- millisecond precision, and two entries in the same millisecond would fork a project's
-- chain (PROJECT.md 4.13.3).
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
  "seq" bigint DEFAULT nextval('audit_events_seq') NOT NULL,
  "prev_hash" text NOT NULL,
  "entry_hash" text NOT NULL,
  "outbox_seq" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE INDEX "audit_events_project_created_idx" ON "audit_events" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX "audit_events_project_seq_idx" ON "audit_events" USING btree ("project_id","seq");
--> statement-breakpoint
CREATE INDEX "audit_events_project_actor_idx" ON "audit_events" USING btree ("project_id","actor_id");
--> statement-breakpoint
-- One entry per outbox event, which is what makes a replayed relay a no-op rather than a
-- duplicate. `created_at` leads because a unique index on a partitioned table must contain
-- the partition key.
CREATE UNIQUE INDEX "audit_events_outbox_seq_key" ON "audit_events" USING btree ("created_at","outbox_seq");
--> statement-breakpoint
-- 3. Table grants ----------------------------------------------------------------------
-- Explicit and one shape at a time, because the shape is the control. A table that must
-- refuse a verb refuses it by never being granted it, and a grant loop over pg_class
-- would hand all four to everything and leave the refusals to a later REVOKE somebody has
-- to remember (which is how the audit trail was writable for twenty-nine migrations).
--
-- `project_purges` appears in no list here on purpose: it is written only by
-- `purge_project`, which is SECURITY DEFINER, so the application role needs no privilege
-- on it at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "api_keys", "auth_codes", "billing_settings",
  "claim_templates", "credit_grants", "data_subject_requests",
  "email_change_requests", "email_templates", "idempotency_keys",
  "identities", "invoice_lines", "invoices",
  "magic_link_tokens", "mfa_challenges", "mfa_factors",
  "mfa_recovery_codes", "oauth_flows", "oauth_providers",
  "onboarding_responses", "org_invitations", "org_members",
  "org_security_settings", "orgs", "otp_challenges",
  "outbox", "payment_methods", "project_domains",
  "project_origins", "project_signing_keys", "project_spend_state",
  "projects", "redirect_uris", "refresh_tokens",
  "relay_offsets", "retention_policies", "sessions",
  "sms_policies", "staff_access_grants", "suppressions",
  "top_ups", "usage_daily", "usage_hourly",
  "users", "verification_tokens", "webauthn_challenges",
  "webauthn_credentials", "webauthn_relying_parties", "webhook_deliveries",
  "webhook_endpoint_stats", "webhooks"
  TO idenzy_app;
--> statement-breakpoint
-- Accumulating records with no delete: a bounce statistic, a provider event, a debt and a
-- billing cursor are all things an operator may correct but nothing may quietly drop.
GRANT SELECT, INSERT, UPDATE ON TABLE
  "email_delivery_stats", "email_provider_events", "email_sending_holds",
  "org_debts", "payment_provider_events", "usage_billing_state"
  TO idenzy_app;
--> statement-breakpoint
-- Append-only. THE integrity control for the audit trail (PROJECT.md 4.13.3): with no
-- UPDATE or DELETE on the connection, no application code path can rewrite history, and
-- the hash chain is left to prove what the privileges already prevent. `usage_charges` and
-- `usage_periods` are the same promise about money — a charge is superseded by a later
-- repricing row, never edited (ADR-0014).
GRANT SELECT, INSERT ON TABLE
  "audit_events", "usage_charges", "usage_periods"
  TO idenzy_app;
--> statement-breakpoint
-- 4. Sequences -------------------------------------------------------------------------
-- Both are cluster-wide counters read through a column default, so the role needs USAGE to
-- advance them and SELECT to read one back.
GRANT SELECT, USAGE ON SEQUENCE "audit_events_seq" TO idenzy_app;
--> statement-breakpoint
GRANT SELECT, USAGE ON SEQUENCE "outbox_seq" TO idenzy_app;
--> statement-breakpoint
-- 5. Functions -------------------------------------------------------------------------
-- Every one of these exists so the application role does not have to hold a privilege that
-- would be larger than the job: creating a partition, reading across tenants to resolve a
-- project, sweeping expired rows, or appending to an append-only table. They are SECURITY
-- DEFINER and therefore run as the owner, so each is revoked from PUBLIC before it is
-- granted to anybody.
CREATE FUNCTION public.append_audit_event(p_project_id uuid, p_actor_type text, p_actor_id text, p_action text, p_target text, p_ip text, p_ua text, p_metadata jsonb, p_prev_hash text, p_entry_hash text, p_created_at timestamp with time zone, p_outbox_seq bigint) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH appended AS (
    INSERT INTO public.audit_events
      (project_id, actor_type, actor_id, action, target, ip, ua, metadata,
       prev_hash, entry_hash, created_at, outbox_seq)
    VALUES
      (p_project_id, p_actor_type, p_actor_id, p_action, p_target, p_ip, p_ua, p_metadata,
       p_prev_hash, p_entry_hash, p_created_at, p_outbox_seq)
    -- A null outbox_seq never conflicts, which is the right reading: an entry with no
    -- outbox event behind it has nothing to be a replay of.
    ON CONFLICT (created_at, outbox_seq) DO NOTHING
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM appended);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.append_audit_event(p_project_id uuid, p_actor_type text, p_actor_id text, p_action text, p_target text, p_ip text, p_ua text, p_metadata jsonb, p_prev_hash text, p_entry_hash text, p_created_at timestamp with time zone, p_outbox_seq bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION public.append_audit_event(p_project_id uuid, p_actor_type text, p_actor_id text, p_action text, p_target text, p_ip text, p_ua text, p_metadata jsonb, p_prev_hash text, p_entry_hash text, p_created_at timestamp with time zone, p_outbox_seq bigint) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.audit_chain_for(p_project_id uuid) RETURNS TABLE(project_id uuid, actor_type text, actor_id text, action text, target text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamp with time zone, seq bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT a.project_id, a.actor_type, a.actor_id, a.action, a.target, a.metadata,
         a.prev_hash, a.entry_hash, a.created_at, a.seq
  FROM public.audit_events a
  WHERE a.project_id = p_project_id
  ORDER BY a.seq ASC;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_chain_for(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_chain_for(p_project_id uuid) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.audit_chain_tip(p_project_id uuid) RETURNS TABLE(entry_hash text, seq bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT a.entry_hash, a.seq
  FROM public.audit_events a
  WHERE a.project_id = p_project_id
  ORDER BY a.seq DESC
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_chain_tip(p_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_chain_tip(p_project_id uuid) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.email_prune_delivery_stats(older_than date, max_rows integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
REVOKE ALL ON FUNCTION public.email_prune_delivery_stats(older_than date, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.email_prune_delivery_stats(older_than date, max_rows integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.email_prune_provider_events(older_than timestamp with time zone, max_rows integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
REVOKE ALL ON FUNCTION public.email_prune_provider_events(older_than timestamp with time zone, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.email_prune_provider_events(older_than timestamp with time zone, max_rows integer) TO idenzy_app;
--> statement-breakpoint
-- Left ungranted, which is not an oversight: it is the only function here that is not
-- SECURITY DEFINER, so a caller runs it with their own rights and `idenzy_app` holds no
-- CREATE on the schema. `ensure_audit_partitions_ahead` below is the granted wrapper and
-- the one entry point the worker reaches.
CREATE FUNCTION public.ensure_audit_partition(target date) RETURNS void
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
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM idenzy_app', name);
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION public.ensure_audit_partitions_ahead(p_months integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  created int := 0;
  horizon int := least(greatest(coalesce(p_months, 3), 1), 12);
  target  date;
  name    text;
  i       int;
BEGIN
  -- From the current month outwards, so a cold start with no partitions repairs itself
  -- rather than only covering the future and still failing on today's inserts.
  FOR i IN 0..horizon LOOP
    target := (date_trunc('month', CURRENT_DATE) + make_interval(months => i))::date;
    name   := format('audit_events_%s', to_char(target, 'YYYY_MM'));

    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = name) THEN
      -- Two workers starting together both see the gap and both try to fill it. The loser
      -- gets duplicate_table, which is the desired state arriving by another route, not an
      -- error worth failing a maintenance pass over.
      BEGIN
        PERFORM ensure_audit_partition(target);
        created := created + 1;
      EXCEPTION
        WHEN duplicate_table THEN NULL;
      END;
    END IF;
  END LOOP;

  RETURN created;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ensure_audit_partitions_ahead(p_months integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_audit_partitions_ahead(p_months integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.orgs_with_recent_usage(p_since date, p_limit integer) RETURNS TABLE(org_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT DISTINCT p.org_id
  FROM public.usage_daily d
  JOIN public.projects p ON p.id = d.project_id
  WHERE d.day >= p_since
  ORDER BY p.org_id
  LIMIT p_limit;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.orgs_with_recent_usage(p_since date, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.orgs_with_recent_usage(p_since date, p_limit integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.outbox_events_since(p_topic text, p_since_seq bigint, p_not_before timestamp with time zone) RETURNS TABLE(id uuid, project_id uuid, topic text, payload jsonb, created_at timestamp with time zone, seq bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT o.id, o.project_id, o.topic, o.payload, o.created_at, o.seq
  FROM public.outbox o
  WHERE o.topic = p_topic
    AND o.seq > p_since_seq
    AND (p_not_before IS NULL OR o.created_at >= p_not_before)
  -- By seq alone. Ordering by created_at first would reintroduce the tie the sequence
  -- exists to break, and `id` as the tiebreaker is a random uuid.
  ORDER BY o.seq
  LIMIT 1000;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbox_events_since(p_topic text, p_since_seq bigint, p_not_before timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.outbox_events_since(p_topic text, p_since_seq bigint, p_not_before timestamp with time zone) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.outbox_seq_before(p_topic text, p_at timestamp with time zone) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT COALESCE(max(o.seq), 0)
  FROM public.outbox o
  WHERE o.topic = p_topic
    AND o.created_at < p_at;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.outbox_seq_before(p_topic text, p_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.outbox_seq_before(p_topic text, p_at timestamp with time zone) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.projects_for_email_reputation(p_since date, p_limit integer) RETURNS TABLE(project_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
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
REVOKE ALL ON FUNCTION public.projects_for_email_reputation(p_since date, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.projects_for_email_reputation(p_since date, p_limit integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.purge_project(p_org_id uuid, p_project_id uuid, p_purged_by text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  removed int;
BEGIN
  -- Ownership is re-checked here and not taken on trust. SECURITY DEFINER runs outside RLS, so
  -- the policy that would otherwise stop one organisation naming another's project does not
  -- apply inside this body. ProjectScope makes the same check a layer up; this is the one that
  -- holds if anything ever calls the function directly.
  IF NOT EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND org_id = p_org_id
  ) THEN
    -- Null rather than an exception: "not yours" and "not there" answer the same way, so a
    -- caller cannot use this to discover that a project id is real.
    RETURN NULL;
  END IF;

  DELETE FROM audit_events WHERE project_id = p_project_id;
  GET DIAGNOSTICS removed = ROW_COUNT;

  -- The cascade from 0060 empties the other 37 tables. One statement, one transaction with the
  -- audit delete above, so a purge cannot half-happen and leave a project whose trail is gone.
  DELETE FROM projects WHERE id = p_project_id;

  INSERT INTO project_purges (project_id, org_id, audit_rows_deleted, purged_by)
  VALUES (p_project_id, p_org_id, removed, p_purged_by);

  RETURN removed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.purge_project(p_org_id uuid, p_project_id uuid, p_purged_by text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_project(p_org_id uuid, p_project_id uuid, p_purged_by text) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.resolve_open_invitation(p_token_hash text, p_now timestamp with time zone) RETURNS TABLE(id uuid, org_id uuid, email text, role text, invited_by uuid, created_at timestamp with time zone, expires_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT i.id, i.org_id, i.email, i.role, i.invited_by, i.created_at, i.expires_at
  FROM public.org_invitations i
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > p_now
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_open_invitation(p_token_hash text, p_now timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_open_invitation(p_token_hash text, p_now timestamp with time zone) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.resolve_project_by_host(p_host text) RETURNS TABLE(project_id uuid, compliance_tier text, plan text, allowed_origins text[], has_auth_domain boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.id, p.compliance_tier, p.plan,
         COALESCE(ARRAY(SELECT o.origin FROM public.project_origins o WHERE o.project_id = p.id),
                  '{}'::text[]),
         true
  FROM public.projects p
  JOIN public.project_domains d ON d.project_id = p.id
  WHERE d.domain = p_host
    AND d.type = 'auth'
    AND d.status = 'verified'
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_project_by_host(p_host text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_project_by_host(p_host text) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.resolve_project_by_key_hash(p_hash text) RETURNS TABLE(project_id uuid, compliance_tier text, plan text, key_kind text, scopes text[], allowed_origins text[], has_auth_domain boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.id, p.compliance_tier, p.plan, k.kind, k.scopes,
         COALESCE(ARRAY(SELECT o.origin FROM public.project_origins o WHERE o.project_id = p.id),
                  '{}'::text[]),
         EXISTS (SELECT 1 FROM public.project_domains d
                 WHERE d.project_id = p.id AND d.type = 'auth' AND d.status = 'verified')
  FROM public.api_keys k
  JOIN public.projects p ON p.id = k.project_id
  WHERE k.hash = p_hash
    AND k.revoked_at IS NULL
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_project_by_key_hash(p_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_project_by_key_hash(p_hash text) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.retention_sweep_oauth_flows(default_age interval, max_rows integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  removed bigint;
BEGIN
  WITH ages AS (
    SELECT p.id AS project_id,
           coalesce(
             (SELECT r.max_age::interval FROM retention_policies r
              WHERE r.project_id = p.id AND r.subject = 'oauth_flows'),
             default_age
           ) AS age
    FROM projects p
  ),
  doomed AS (
    SELECT f.id FROM oauth_flows f JOIN ages a ON a.project_id = f.project_id
    WHERE f.created_at < now() - a.age
    ORDER BY f.id
    LIMIT max_rows
  )
  DELETE FROM oauth_flows f USING doomed d WHERE f.id = d.id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.retention_sweep_oauth_flows(default_age interval, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retention_sweep_oauth_flows(default_age interval, max_rows integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.retention_sweep_otp_challenges(default_age interval, max_rows integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  removed bigint;
BEGIN
  WITH ages AS (
    SELECT p.id AS project_id,
           coalesce(
             (SELECT r.max_age::interval FROM retention_policies r
              WHERE r.project_id = p.id AND r.subject = 'otp_challenges'),
             default_age
           ) AS age
    FROM projects p
  ),
  doomed AS (
    SELECT c.id FROM otp_challenges c JOIN ages a ON a.project_id = c.project_id
    WHERE c.created_at < now() - a.age
    ORDER BY c.id
    LIMIT max_rows
  )
  DELETE FROM otp_challenges c USING doomed d WHERE c.id = d.id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.retention_sweep_otp_challenges(default_age interval, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retention_sweep_otp_challenges(default_age interval, max_rows integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.retention_sweep_sessions(default_age interval, max_rows integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  removed bigint;
BEGIN
  WITH ages AS (
    SELECT p.id AS project_id,
           coalesce(
             (SELECT r.max_age::interval FROM retention_policies r
              WHERE r.project_id = p.id AND r.subject = 'sessions'),
             default_age
           ) AS age
    FROM projects p
  ),
  doomed AS (
    SELECT s.id FROM sessions s JOIN ages a ON a.project_id = s.project_id
    WHERE coalesce(s.revoked_at, s.absolute_expires_at) < now() - a.age
    ORDER BY s.id
    LIMIT max_rows
  )
  DELETE FROM sessions s USING doomed d WHERE s.id = d.id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.retention_sweep_sessions(default_age interval, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retention_sweep_sessions(default_age interval, max_rows integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.retention_tombstone_users(default_age interval, max_rows integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  stripped bigint;
BEGIN
  WITH ages AS (
    SELECT p.id AS project_id,
           coalesce(
             (SELECT r.max_age::interval FROM retention_policies r
              WHERE r.project_id = p.id AND r.subject = 'users'),
             default_age
           ) AS age
    FROM projects p
  ),
  doomed AS (
    SELECT u.id FROM users u JOIN ages a ON a.project_id = u.project_id
    WHERE u.deleted_at IS NOT NULL
      AND u.deleted_at < now() - a.age
      AND (u.email IS NOT NULL
        OR u.phone IS NOT NULL
        OR u.password_hash IS NOT NULL
        OR u.display_name IS NOT NULL
        OR u.avatar_url IS NOT NULL
        OR u.metadata_public <> '{}'::jsonb
        OR u.metadata_private <> '{}'::jsonb)
    ORDER BY u.id
    LIMIT max_rows
  )
  UPDATE users u SET
    email = NULL,
    phone = NULL,
    password_hash = NULL,
    display_name = NULL,
    avatar_url = NULL,
    metadata_public = '{}'::jsonb,
    metadata_private = '{}'::jsonb,
    updated_at = now()
  FROM doomed d WHERE u.id = d.id;
  GET DIAGNOSTICS stripped = ROW_COUNT;
  RETURN stripped;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.retention_tombstone_users(default_age interval, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retention_tombstone_users(default_age interval, max_rows integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.revocation_events_since(p_since timestamp with time zone) RETURNS TABLE(project_id uuid, topic text, payload jsonb, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT o.project_id, o.topic, o.payload, o.created_at
  FROM public.outbox o
  WHERE o.created_at >= p_since
    AND o.topic IN ('session.revoked', 'security.refresh_token_reused')
  ORDER BY o.created_at ASC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.revocation_events_since(p_since timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revocation_events_since(p_since timestamp with time zone) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.usage_closable_periods(before_period date, max_periods integer) RETURNS TABLE(project_id uuid, period date)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
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
REVOKE ALL ON FUNCTION public.usage_closable_periods(before_period date, max_periods integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.usage_closable_periods(before_period date, max_periods integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.usage_projects_with_activity(since date, max_projects integer) RETURNS TABLE(project_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT d.project_id
  FROM usage_daily d
  WHERE d.day >= since
  GROUP BY d.project_id
  ORDER BY d.project_id
  LIMIT max_projects;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.usage_projects_with_activity(since date, max_projects integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.usage_projects_with_activity(since date, max_projects integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.usage_prune_daily(older_than date, max_rows integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
REVOKE ALL ON FUNCTION public.usage_prune_daily(older_than date, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.usage_prune_daily(older_than date, max_rows integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.usage_prune_hourly(older_than timestamp with time zone, max_rows integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
REVOKE ALL ON FUNCTION public.usage_prune_hourly(older_than timestamp with time zone, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.usage_prune_hourly(older_than timestamp with time zone, max_rows integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.usage_prune_periods(older_than date, max_rows integer) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
REVOKE ALL ON FUNCTION public.usage_prune_periods(older_than date, max_rows integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.usage_prune_periods(older_than date, max_rows integer) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.webhook_projects_with_due_deliveries(due_before timestamp with time zone, max_projects integer) RETURNS TABLE(project_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
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
REVOKE ALL ON FUNCTION public.webhook_projects_with_due_deliveries(due_before timestamp with time zone, max_projects integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.webhook_projects_with_due_deliveries(due_before timestamp with time zone, max_projects integer) TO idenzy_app;
--> statement-breakpoint
-- 6. Default privileges ------------------------------------------------------------------
-- What a table created after this migration gets before anybody grants anything. SELECT and
-- INSERT only: they are what an ordinary new table needs, and no table has ever wanted to
-- refuse them. UPDATE and DELETE are exactly the verbs an append-only table exists to
-- withhold, and a default privilege cannot be narrowed per table — it can only be revoked
-- afterwards by somebody who remembered. Leaving them out of the default is what makes
-- section 3's shapes hold for tables that do not exist yet.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO idenzy_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO idenzy_app;
--> statement-breakpoint
-- 7. Open the first partitions ------------------------------------------------------------
-- The current month and the next three, so a fresh database can take an audit entry before
-- any worker has run. `audit-partition-maintainer` keeps the horizon from there; without it,
-- inserts start failing with "no partition of relation found for row" a few months after any
-- deploy, and the request that fails is the one the trail exists to record.
SELECT ensure_audit_partitions_ahead(3);
