-- The project of a browser that arrives with nothing but a one-time secret: a clicked
-- magic link (its token) and a provider's OAuth callback (its state). Both land on the shared
-- API host, where there is no publishable key to read and no auth domain to match, so the
-- secret the flow stored is the only thing that names the project. Same shape and grants as
-- resolve_project_by_key_hash; neither function says anything about the flow itself, which
-- the service still checks (expiry, single use) inside the project it returns.
CREATE FUNCTION public.resolve_project_by_magic_link(p_token_hash text) RETURNS TABLE(project_id uuid, compliance_tier text, plan text, allowed_origins text[], has_auth_domain boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.id, p.compliance_tier, p.plan,
         COALESCE(ARRAY(SELECT o.origin FROM public.project_origins o WHERE o.project_id = p.id),
                  '{}'::text[]),
         EXISTS (SELECT 1 FROM public.project_domains d
                 WHERE d.project_id = p.id AND d.type = 'auth' AND d.status = 'verified')
  FROM public.magic_link_tokens t
  JOIN public.projects p ON p.id = t.project_id
  WHERE t.token_hash = p_token_hash
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_project_by_magic_link(p_token_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_project_by_magic_link(p_token_hash text) TO idenzy_app;
--> statement-breakpoint
CREATE FUNCTION public.resolve_project_by_oauth_state(p_state text) RETURNS TABLE(project_id uuid, compliance_tier text, plan text, allowed_origins text[], has_auth_domain boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.id, p.compliance_tier, p.plan,
         COALESCE(ARRAY(SELECT o.origin FROM public.project_origins o WHERE o.project_id = p.id),
                  '{}'::text[]),
         EXISTS (SELECT 1 FROM public.project_domains d
                 WHERE d.project_id = p.id AND d.type = 'auth' AND d.status = 'verified')
  FROM public.oauth_flows f
  JOIN public.projects p ON p.id = f.project_id
  WHERE f.state = p_state
  LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_project_by_oauth_state(p_state text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_project_by_oauth_state(p_state text) TO idenzy_app;
