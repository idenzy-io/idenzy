-- Erases one end user of one project, now (PROJECT.md 4.13.6, GDPR Art. 17).
--
-- One function rather than a dozen repository calls, for the reason
-- retention_tombstone_users names its columns in SQL: the list of what an erasure touches is
-- a second copy of a classification the schema already owns, and keeping it in one body is
-- what lets `user-erasure.test.ts` read it back and hold it to `classified()`. It is also one
-- round trip inside the caller's transaction instead of fifteen.
--
-- SECURITY INVOKER, unlike its neighbours: everything here is a tenant-scoped write the
-- application role already holds, so there is no privilege to borrow, and `p_project_id` is in
-- every predicate because there is no row policy underneath to supply it (PROJECT.md 4.10).
--
-- What happens to each table follows its classification. `users` and `sessions` are
-- tombstoned: the audit trail points at both ids, and an erasure that broke the chain would
-- read as tampering. Everything else that belongs to the user is a way back in or the
-- leftovers of one, and goes: identities, factors, passkeys, recovery codes, and every
-- challenge, code, token, link and flow. Refresh tokens go with their sessions' revocation,
-- so nothing the person's devices still hold can be exchanged for anything.
--
-- `otp_challenges` hold a digest of the address rather than the user, so the caller passes
-- the digests of the addresses the account held, computed the way the OTP flows compute them.
--
-- Returns the sessions this ended, which the caller publishes as revoked, or NULL when there
-- is no live user by that id: an unknown id and an erased one are one answer on purpose.
CREATE FUNCTION public.erase_user(p_project_id uuid, p_user_id uuid, p_target_hashes text[], p_at timestamp with time zone) RETURNS uuid[]
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  ended uuid[];
BEGIN
  UPDATE public.users u SET
    email = NULL,
    phone = NULL,
    password_hash = NULL,
    display_name = NULL,
    avatar_url = NULL,
    metadata_public = '{}',
    metadata_private = '{}',
    deleted_at = p_at,
    updated_at = p_at
  WHERE u.project_id = p_project_id
    AND u.id = p_user_id
    AND u.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(array_agg(s.id), '{}') INTO ended
  FROM public.sessions s
  WHERE s.project_id = p_project_id
    AND s.user_id = p_user_id
    AND s.revoked_at IS NULL;

  UPDATE public.sessions s SET
    device_id = NULL,
    device_name = NULL,
    ip = NULL,
    user_agent = NULL,
    revoked_at = coalesce(s.revoked_at, p_at),
    revoke_reason = coalesce(s.revoke_reason, 'user_deleted')
  WHERE s.project_id = p_project_id
    AND s.user_id = p_user_id;

  DELETE FROM public.refresh_tokens r
  USING public.sessions s
  WHERE r.project_id = p_project_id
    AND s.project_id = p_project_id
    AND s.user_id = p_user_id
    AND r.session_id = s.id;

  DELETE FROM public.identities t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.mfa_factors t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.mfa_recovery_codes t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.webauthn_credentials t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.mfa_challenges t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.webauthn_challenges t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.auth_codes t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.verification_tokens t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.magic_link_tokens t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.email_change_requests t WHERE t.project_id = p_project_id AND t.user_id = p_user_id;
  DELETE FROM public.oauth_flows t WHERE t.project_id = p_project_id AND t.link_user_id = p_user_id;
  DELETE FROM public.otp_challenges t
  WHERE t.project_id = p_project_id
    AND t.target_hash = ANY(p_target_hashes);

  RETURN ended;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.erase_user(p_project_id uuid, p_user_id uuid, p_target_hashes text[], p_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.erase_user(p_project_id uuid, p_user_id uuid, p_target_hashes text[], p_at timestamp with time zone) TO idenzy_app;
