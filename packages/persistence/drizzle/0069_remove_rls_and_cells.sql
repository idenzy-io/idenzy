-- Removes row-level security, the control-plane/cell split, and the machinery that
-- existed only to step around a policy.
--
-- Hand-authored (ADR-0001): drizzle-kit generates none of this.
--
-- **What this gives up.** Until now a tenant table answered with zero rows unless
-- `app.project_id` matched, whatever the application asked for. After this the database
-- answers what it is asked. What remains is `BaseRepository.tenantScope()` and
-- `OrgRepository.orgScope()`, which every query in the package already went through --
-- the audit before this change found 232 of 233 statements filtering in SQL and fixed the
-- one that did not. That is now the only line rather than the first of two.
--
-- Grants are deliberately untouched. `idenzy_app` keeps exactly the privileges it had,
-- including the missing UPDATE and DELETE on `audit_events`, which is the integrity
-- control of PROJECT.md 4.13.3 and never had anything to do with RLS.
--> statement-breakpoint
-- 1. The policies, by name, so one added later and not listed here fails loudly
--    rather than being swept up by a loop.
--> statement-breakpoint
DROP POLICY IF EXISTS "api_keys_tenant_isolation" ON "api_keys";
--> statement-breakpoint
DROP POLICY IF EXISTS "oauth_providers_tenant_isolation" ON "oauth_providers";
--> statement-breakpoint
DROP POLICY IF EXISTS "project_domains_tenant_isolation" ON "project_domains";
--> statement-breakpoint
DROP POLICY IF EXISTS "projects_tenant_isolation" ON "projects";
--> statement-breakpoint
DROP POLICY IF EXISTS "redirect_uris_tenant_isolation" ON "redirect_uris";
--> statement-breakpoint
DROP POLICY IF EXISTS "identities_tenant_isolation" ON "identities";
--> statement-breakpoint
DROP POLICY IF EXISTS "users_tenant_isolation" ON "users";
--> statement-breakpoint
DROP POLICY IF EXISTS "idempotency_keys_tenant_isolation" ON "idempotency_keys";
--> statement-breakpoint
DROP POLICY IF EXISTS "refresh_tokens_tenant_isolation" ON "refresh_tokens";
--> statement-breakpoint
DROP POLICY IF EXISTS "sessions_tenant_isolation" ON "sessions";
--> statement-breakpoint
DROP POLICY IF EXISTS "mfa_factors_tenant_isolation" ON "mfa_factors";
--> statement-breakpoint
DROP POLICY IF EXISTS "webauthn_credentials_tenant_isolation" ON "webauthn_credentials";
--> statement-breakpoint
DROP POLICY IF EXISTS "magic_link_tokens_tenant_isolation" ON "magic_link_tokens";
--> statement-breakpoint
DROP POLICY IF EXISTS "oauth_flows_tenant_isolation" ON "oauth_flows";
--> statement-breakpoint
DROP POLICY IF EXISTS "otp_challenges_tenant_isolation" ON "otp_challenges";
--> statement-breakpoint
DROP POLICY IF EXISTS "email_templates_tenant_isolation" ON "email_templates";
--> statement-breakpoint
DROP POLICY IF EXISTS "outbox_tenant_isolation" ON "outbox";
--> statement-breakpoint
DROP POLICY IF EXISTS "suppressions_tenant_isolation" ON "suppressions";
--> statement-breakpoint
DROP POLICY IF EXISTS "webhook_deliveries_tenant_isolation" ON "webhook_deliveries";
--> statement-breakpoint
DROP POLICY IF EXISTS "webhooks_tenant_isolation" ON "webhooks";
--> statement-breakpoint
DROP POLICY IF EXISTS "usage_daily_tenant_isolation" ON "usage_daily";
--> statement-breakpoint
DROP POLICY IF EXISTS "audit_events_tenant_isolation" ON "audit_events";
--> statement-breakpoint
DROP POLICY IF EXISTS "data_subject_requests_tenant_isolation" ON "data_subject_requests";
--> statement-breakpoint
DROP POLICY IF EXISTS "retention_policies_tenant_isolation" ON "retention_policies";
--> statement-breakpoint
DROP POLICY IF EXISTS "auth_codes_tenant_isolation" ON "auth_codes";
--> statement-breakpoint
DROP POLICY IF EXISTS "email_change_requests_tenant_isolation" ON "email_change_requests";
--> statement-breakpoint
DROP POLICY IF EXISTS "verification_tokens_tenant_isolation" ON "verification_tokens";
--> statement-breakpoint
DROP POLICY IF EXISTS "webauthn_challenges_tenant_isolation" ON "webauthn_challenges";
--> statement-breakpoint
DROP POLICY IF EXISTS "webauthn_relying_parties_tenant_isolation" ON "webauthn_relying_parties";
--> statement-breakpoint
DROP POLICY IF EXISTS "project_origins_tenant_isolation" ON "project_origins";
--> statement-breakpoint
DROP POLICY IF EXISTS "sms_policies_tenant_isolation" ON "sms_policies";
--> statement-breakpoint
DROP POLICY IF EXISTS "mfa_challenges_tenant_isolation" ON "mfa_challenges";
--> statement-breakpoint
DROP POLICY IF EXISTS "mfa_recovery_codes_tenant_isolation" ON "mfa_recovery_codes";
--> statement-breakpoint
DROP POLICY IF EXISTS "claim_templates_tenant_isolation" ON "claim_templates";
--> statement-breakpoint
DROP POLICY IF EXISTS "orgs_org_isolation" ON "orgs";
--> statement-breakpoint
DROP POLICY IF EXISTS "org_invitations_org_isolation" ON "org_invitations";
--> statement-breakpoint
DROP POLICY IF EXISTS "org_members_org_isolation" ON "org_members";
--> statement-breakpoint
DROP POLICY IF EXISTS "org_security_settings_org_isolation" ON "org_security_settings";
--> statement-breakpoint
DROP POLICY IF EXISTS "billing_settings_org_isolation" ON "billing_settings";
--> statement-breakpoint
DROP POLICY IF EXISTS "credit_grants_org_isolation" ON "credit_grants";
--> statement-breakpoint
DROP POLICY IF EXISTS "invoice_lines_org_isolation" ON "invoice_lines";
--> statement-breakpoint
DROP POLICY IF EXISTS "invoices_org_isolation" ON "invoices";
--> statement-breakpoint
DROP POLICY IF EXISTS "payment_methods_org_isolation" ON "payment_methods";
--> statement-breakpoint
DROP POLICY IF EXISTS "top_ups_org_isolation" ON "top_ups";
--> statement-breakpoint
DROP POLICY IF EXISTS "projects_org_isolation" ON "projects";
--> statement-breakpoint
DROP POLICY IF EXISTS "onboarding_responses_org_isolation" ON "onboarding_responses";
--> statement-breakpoint
DROP POLICY IF EXISTS "webhook_endpoint_stats_tenant_isolation" ON "webhook_endpoint_stats";
--> statement-breakpoint
DROP POLICY IF EXISTS "usage_periods_tenant_isolation" ON "usage_periods";
--> statement-breakpoint
DROP POLICY IF EXISTS "usage_hourly_tenant_isolation" ON "usage_hourly";
--> statement-breakpoint
DROP POLICY IF EXISTS "org_debts_org_isolation" ON "org_debts";
--> statement-breakpoint
DROP POLICY IF EXISTS "usage_billing_state_org_isolation" ON "usage_billing_state";
--> statement-breakpoint
DROP POLICY IF EXISTS "usage_charges_org_isolation" ON "usage_charges";
--> statement-breakpoint
DROP POLICY IF EXISTS "email_delivery_stats_tenant_isolation" ON "email_delivery_stats";
--> statement-breakpoint
DROP POLICY IF EXISTS "email_sending_holds_tenant_isolation" ON "email_sending_holds";
--> statement-breakpoint
DROP POLICY IF EXISTS "project_spend_state_tenant_isolation" ON "project_spend_state";
--> statement-breakpoint
DROP POLICY IF EXISTS "project_signing_keys_tenant_isolation" ON "project_signing_keys";
--> statement-breakpoint
-- 2. Row-level security itself.
--> statement-breakpoint
ALTER TABLE "api_keys" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_codes" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth_codes" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_settings" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_settings" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "claim_templates" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "claim_templates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_grants" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_grants" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "data_subject_requests" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "data_subject_requests" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_change_requests" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_change_requests" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_delivery_stats" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_delivery_stats" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_sending_holds" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_sending_holds" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_templates" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_templates" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_keys" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "identities" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "identities" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_lines" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_lines" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mfa_challenges" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mfa_challenges" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mfa_factors" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mfa_factors" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_flows" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_flows" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_providers" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "oauth_providers" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_responses" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_responses" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_debts" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_debts" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_invitations" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_invitations" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_members" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_members" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_security_settings" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "org_security_settings" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orgs" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "orgs" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "otp_challenges" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "otp_challenges" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_methods" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_methods" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_domains" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_domains" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_origins" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_origins" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_signing_keys" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_signing_keys" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_spend_state" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_spend_state" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "projects" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "projects" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "redirect_uris" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "redirect_uris" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "refresh_tokens" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retention_policies" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retention_policies" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sms_policies" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sms_policies" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "suppressions" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "suppressions" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "top_ups" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "top_ups" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_billing_state" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_billing_state" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_charges" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_charges" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_daily" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_daily" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_hourly" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_hourly" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_periods" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_periods" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification_tokens" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification_tokens" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webauthn_challenges" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webauthn_challenges" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webauthn_credentials" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webauthn_credentials" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webauthn_relying_parties" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webauthn_relying_parties" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoint_stats" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoint_stats" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhooks" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhooks" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- 3. The two definer-rights functions that existed only because `org_members` carried a
--    policy this lookup had to run in front of. `OrgMembershipReader` selects directly now.
--> statement-breakpoint
DROP FUNCTION IF EXISTS resolve_org_membership(uuid, uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS orgs_for_user(uuid);
--> statement-breakpoint
-- 4. Project resolution, re-declared without `cell_id`, because step 5 drops the column
--    they select. Still SECURITY DEFINER, and that is not an RLS leftover: auth-api calls
--    these to find out *which* project a request is for, before it has a scope to bind.
--> statement-breakpoint
DROP FUNCTION IF EXISTS resolve_project_by_host(text);
--> statement-breakpoint
CREATE FUNCTION resolve_project_by_host(p_host text)
RETURNS TABLE (
  project_id uuid, compliance_tier text, plan text,
  allowed_origins text[], has_auth_domain boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
-- Empty search_path: a SECURITY DEFINER function that resolves unqualified names
-- through the caller's search_path is a privilege-escalation vector.
SET search_path = ''
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
REVOKE ALL ON FUNCTION resolve_project_by_host(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_project_by_host(text) TO idenzy_app;
--> statement-breakpoint
DROP FUNCTION IF EXISTS resolve_project_by_key_hash(text);
--> statement-breakpoint
CREATE FUNCTION resolve_project_by_key_hash(p_hash text)
RETURNS TABLE (
  project_id uuid, compliance_tier text, plan text,
  key_kind text, scopes text[], allowed_origins text[], has_auth_domain boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
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
REVOKE ALL ON FUNCTION resolve_project_by_key_hash(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_project_by_key_hash(text) TO idenzy_app;
--> statement-breakpoint
-- 5. The cells. `cell_id` was immutable behind a trigger because moving a project
--    between independent regional stacks was an audited migration; with one deployment
--    there is nothing to move between.
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_cell_id_immutable ON projects;
--> statement-breakpoint
DROP TRIGGER IF EXISTS orgs_cell_id_immutable ON orgs;
--> statement-breakpoint
DROP FUNCTION IF EXISTS refuse_cell_id_change();
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "cell_id";
--> statement-breakpoint
ALTER TABLE "orgs" DROP COLUMN IF EXISTS "cell_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "region_cells";
