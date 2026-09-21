# Project settings: General

Route: `/settings` · [Page source](../apps/client/app/pages/settings/index.vue)

## User task

I need to identify the project, change its label and avoid destructive mistakes.

## Keep

Keep the immutable project ID, the explicit no-certification statement and a separate danger section. Residency presentation is gone with the cells (PROJECT.md 4.13.5).

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Project settings
[General] [Team / organisation link] [Billing link]
[Project name................]                         [Edit name]
[Project ID........................................] [Copy]
[Organisation] [Plan / effective tier]
[Data location | Actual endpoint | Verified capability status]
[Retention: data category | effective age | Edit if supported]
[Advanced infrastructure reference v]
[Danger zone: Delete project]                    [Delete project...]
```

Keep identity and copyable endpoint above technical controls. Name is the normal editable field; its edit action sits at the row's right. Retention has per-category ownership and a section Save changes action only for genuinely configurable values. Put Delete project in a visually separated bottom section, not beside Rename.

### Mobile arrangement

Stack identity fields with full-value copy controls. Move the small sidebar resource counts into the deletion review where they help the decision. Never make a destructive action sticky during normal reading.

### Buttons, dialogs and states

Rename dialog: current/new label → affected defaults preview → Cancel / Rename project. Delete dialog: project/organisation, affected app/resources, deletes versus retains, prerequisites, type exact project name, Keep project / Delete project permanently. Keep result and failure states distinct.

## Findings and fixes

### P1 — Project, organisation and billing scope disagree

General says members/roles/billing belong to an organisation, while their pages/stores are project-addressed. Resolve the real scope and reflect it in breadcrumbs and actions. Use meaningful organisation/project names rather than interchangeable Team/Project labels.

### P1 — Rename copy contradicts other screens

General says the project name reaches no end users, but templates use project.name and the authenticator issuer can inherit it. Explain exactly which defaults change and which explicit overrides remain; preview affected names before renaming.

### P1 — Infrastructure promises are not verified readiness

The page says signing keys are in KMS and retention is enforced, while service/infrastructure documentation identifies unprovisioned pieces. Show actual environment capability, effective configuration and last confirmed job/control status. Do not use a fixture tier as a compliance attestation.

### P2 — Deletion mixes important consequences with dense prose

ProjectDeleteDialog properly requires the name and lists resource counts, but its opening asks users to read lines out of order. Lead with the project and affected application, then a short Deletes/Retains summary and prerequisites such as exporting records. A legal retention claim needs approved policy, not copy alone.

## Proposed page

Project identity and connected app → effective controls → editable retention → billing/team links → danger zone. Reference descriptions of RLS and key-management internals should be secondary.

## Dialogs and interactions

ProjectNameDialog: show where the new name appears. ProjectDeleteDialog: exact identity, resource counts, irreversible consequences and retained records, with “Delete project permanently.” Keep last-project/ownership restrictions visible before the confirmation rather than as unexplained disabled buttons.

## Acceptance checks

Rename and verify sidebar, default issuer and template previews remain truthful. Compare endpoint with Auth domains/Revocation. Attempt deletion as an unauthorized member and verify server denial, not only a hidden button.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Settled while implementing

The page is the project's own detail page rather than a stack of settings cards, which is
closer to this note's desktop arrangement than the first implementation was: that one
stacked `[Organisation] [Plan]` and `[Data location | Actual endpoint | ...]` as five and
four rows of prose, where the arrangement above draws each as a line. `PageHeader` therefore
titles the project by name, as `users/[id].vue` titles a person, and the breadcrumb and the
settings rail carry "General".

**A fact carries its explanation behind a glyph, and the page surface carries none.** Every
read-only row here used to be a label, a pill and a paragraph; twenty-one of them turned a
configuration screen into an article, which is [shared-experience.md](shared-experience.md)'s
diagnosis word for word. The sentences are unchanged and none was deleted: they moved from
`SettingRow`'s `description` to a `Fact`'s `info`, read through the same glyph and tooltip
`Statistic` already used. `FactGrid` is the new primitive, and it also replaces the
hand-written `grid gap-px` mosaic on ten other pages.

The compliance tier and key custody were cards between two things the reader can
change. They are now one folded section. Residency was the third and is gone with the
region cells (PROJECT.md 4.13.5).
values in the heading while shut, which this file's own collapsed-section rule requires.

Retention keeps its draft, its `Cancel changes` and its `Save changes` at the section's
bottom right, and becomes a `RecordTable` so the five ages read as one decision rather than
five settings. The audit row stays a value with a reason rather than a disabled control.

## Implementation references

- [FactGrid.vue](../apps/client/app/components/FactGrid.vue)
- [DangerZone.vue](../apps/client/app/components/DangerZone.vue)
- [InfoNote.vue](../apps/client/app/components/InfoNote.vue)
- [ProjectNameDialog.vue](../apps/client/app/components/ProjectNameDialog.vue)
- [ProjectDeleteDialog.vue](../apps/client/app/components/ProjectDeleteDialog.vue)
- [project-settings.ts](../apps/client/app/stores/project-settings.ts)
- [users.ts](../apps/client/app/stores/users.ts)
- [sessions.ts](../apps/client/app/stores/sessions.ts)
- [keys.ts](../apps/client/app/stores/keys.ts)
- [audit.ts](../apps/client/app/stores/audit.ts)
- [keys.ts](../apps/client/app/utils/keys.ts)
- [project-settings.ts](../apps/client/app/utils/project-settings.ts)
- [sessions.ts](../apps/client/app/utils/sessions.ts)
