-- `cell_id` is immutable, and now something enforces it (PROJECT.md 4.13.5).
--
-- The claim is old: "set at creation and immutable thereafter. Moving a project between cells is
-- an explicit, audited migration operation, never an UPDATE." What enforced it was omission —
-- `OrgProjectRepository.rename` happened to be the only UPDATE anybody had written against
-- `projects`, so nothing set the column twice because nothing tried. A raw
-- `UPDATE projects SET cell_id = ...` inside an org-bound transaction succeeded.
--
-- That is not a small gap. Every residency statement rests on this column: the generated RoPA,
-- the subprocessor register, the endpoint a customer's SDK is pointed at, and the cross-cell
-- refusal added alongside this migration all read it and none of them would notice it changing.
-- A project silently reassigned is a project whose data is in one jurisdiction and whose paperwork
-- says another — which is worse than a project in the wrong cell, because it is undetectable.
--
-- A trigger rather than a CHECK, because a CHECK cannot see the old row. `orgs.cell_id` gets the
-- same treatment for the same reason: an organisation's cell is what its projects inherit.
CREATE OR REPLACE FUNCTION refuse_cell_id_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.cell_id IS DISTINCT FROM OLD.cell_id THEN
    RAISE EXCEPTION
      'cell_id is immutable on %: moving between cells is an audited migration, not an UPDATE',
      TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
-- `WHEN` keeps this off every unrelated update: a rename does not pay for the check.
CREATE TRIGGER projects_cell_id_immutable
  BEFORE UPDATE ON "projects"
  FOR EACH ROW
  WHEN (NEW.cell_id IS DISTINCT FROM OLD.cell_id)
  EXECUTE FUNCTION refuse_cell_id_change();

--> statement-breakpoint
CREATE TRIGGER orgs_cell_id_immutable
  BEFORE UPDATE ON "orgs"
  FOR EACH ROW
  WHEN (NEW.cell_id IS DISTINCT FROM OLD.cell_id)
  EXECUTE FUNCTION refuse_cell_id_change();
