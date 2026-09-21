-- Grants for the per-project signing keys (0067, ADR-0017).
--
-- Named rather than swept up by a loop, per docs/guide/repo.md: 0004's dynamic DO blocks re-grant
-- the two verbs 0030 withheld from every audit partition, which is how 0042 was first written wrong.
--
-- All four verbs, unlike the append-only tables. A key is created at provisioning, promoted and
-- demoted by a rotation, and deleted by a project purge through the cascade — and the rows this
-- holds are ciphertext: the private half is wrapped by the cell KMS key with the project id as
-- authenticated data, so what the app role can read without KMS is a blob that opens nowhere.
ALTER TABLE public.project_signing_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_signing_keys TO idenzy_app;
