-- Hand-authored: the sweep that makes `retention_policies` a control rather than a description.
--
-- The table has existed since 0000 with a policy, an index and nothing reading it. `classified()`
-- publishes a retention answer per column, the settings screen offered five ages to choose from,
-- and no row was ever deleted on account of any of it — so the published answer was "forever" and
-- the screen was a preference nothing acted on. PROJECT.md 4.13.6 puts it plainly: retention that
-- is not enforced by a job is not retention. This is the job's half.
--
-- Three decisions are worth reading before the SQL.
--
-- SECURITY DEFINER, for the reason 0049 gives and one more. A sweeper serves every project and
-- sets no `app.project_id`, so under FORCE RLS a direct delete matches nothing: no error, no rows,
-- and tables that grow forever while a job reports success. The extra reason here is that the
-- policies themselves are tenant-scoped, so even *reading* what to sweep at is invisible to a
-- caller with no tenant bound.
--
-- The age is resolved in here rather than in the worker, and that is what makes a project with no
-- stored row a project that is still swept. `retention_policies` holds an override and nothing
-- else; `coalesce(override, default_age)` is applied per project inside the statement, so a
-- customer who has never opened the settings screen is on the same schedule as one who has.
-- Writing default rows at project creation would have been the other way round, and it ages badly:
-- the day a default changes, every project created before it keeps the old number forever.
--
-- `max_age` is an ISO 8601 duration because that is what the panel's menus are written in, and
-- Postgres parses 'P90D' as an interval directly. One value, one parser, no second copy of the
-- vocabulary in SQL.
--
-- Bounded per pass and reporting what it removed, so a first pass over a table that has been
-- accumulating is a series of small deletes rather than one statement holding locks for minutes.
--
-- The unique index these rely on for their upsert is drizzle's, in 0051.

--> statement-breakpoint
-- Ended sessions. A session's age runs from when it ended rather than from when it started:
-- `revoked_at` where somebody ended it, the absolute expiry where it timed out. A live session
-- is never in range, whatever the age says, because neither value is in the past yet.
-- `refresh_tokens` goes with it through ON DELETE CASCADE.
CREATE OR REPLACE FUNCTION retention_sweep_sessions(default_age interval, max_rows int)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
-- One-time code challenges, from when the row was written. They are spent within minutes; what a
-- longer age buys is a support answer to "did we send it" and nothing else.
CREATE OR REPLACE FUNCTION retention_sweep_otp_challenges(default_age interval, max_rows int)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
-- OAuth flows, from when the row was written. Single-use and short-lived, kept only long enough to
-- investigate one that went wrong.
CREATE OR REPLACE FUNCTION retention_sweep_oauth_flows(default_age interval, max_rows int)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
-- Deleted accounts, stripped rather than removed.
--
-- The row survives with its id, because the audit trail points at it and an erasure that broke the
-- chain would read as tampering (4.13.6). What goes is every column `classified()` marks for
-- erasure — the seven below, and a test asserts that list against the generator rather than
-- trusting this file to have kept up, because a column added to `users` next year is a column this
-- statement would otherwise leave behind in every tombstoned row.
--
-- `email IS NOT NULL OR ...` is not an optimisation. Without it every pass re-updates every
-- tombstone ever written, which is a `max_rows` budget spent on rows that are already clear and a
-- `updated_at` that moves for no reason.
CREATE OR REPLACE FUNCTION retention_tombstone_users(default_age interval, max_rows int)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
REVOKE ALL ON FUNCTION retention_sweep_sessions(interval, int) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION retention_sweep_otp_challenges(interval, int) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION retention_sweep_oauth_flows(interval, int) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION retention_tombstone_users(interval, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION retention_sweep_sessions(interval, int) TO idenzy_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION retention_sweep_otp_challenges(interval, int) TO idenzy_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION retention_sweep_oauth_flows(interval, int) TO idenzy_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION retention_tombstone_users(interval, int) TO idenzy_app;
