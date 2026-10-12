-- What the application may do to the table 0014 added (PROJECT.md 4.4).
--
-- The default privileges give a new table SELECT and INSERT only. A nonce is spent by deleting it,
-- and the next issue for a project deletes that project's expired ones, so the app role needs the
-- write verbs too. All four, like every tenant table that is not an asserted exception: the grants
-- test in tenancy.integration.test.ts is what notices a table that was missed.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "id_token_nonces" TO idenzy_app;
