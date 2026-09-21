-- Grants for the cell-local spend gate (0064, ADR-0016).
--
-- Named rather than swept up by a loop, per docs/guide/repo.md: copying 0004's dynamic DO blocks
-- re-grants the two verbs 0030 withheld from every audit partition, which is how 0042 was first
-- written wrong.
--
-- All four verbs. This is a projection the drawdown rewrites every pass and a project purge
-- deletes by cascade, so unlike the ledger it summarises there is nothing here worth withholding
-- DELETE over: losing a row means the gate opens, which is the direction this control is designed
-- to fail in anyway.
ALTER TABLE public.project_spend_state FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_spend_state TO idenzy_app;
