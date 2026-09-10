# Import users

Route: `/import` · [Page source](../apps/client/app/pages/import/index.vue)

## User task

I need to migrate accounts with a predictable result and know which people will need to reset their passwords.

## Keep

The existing inline four-stage wizard, mapping preview, source choices and separate dry-run action already suit this task better than a generic settings page.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Import users                                        [+ Start import]
[Source] ---> [File] ---> [Map fields] ---> [Review]
[                    Current step workspace                       ]
[Back]                                       [Save draft*] [Continue]
[Past imports: source / file / time / outcome / View report]

Review step:
[Create N] [Update N] [Skip N] [Needs reset N] [Errors N]
[Duplicate handling] [Verification handling] [Affected project]
[Back]                           [Validate without importing] [Import N users]
```

Use a dedicated full-width wizard above history, not a modal. Start import becomes “Cancel setup” while a draft is open. Each step has one obvious Continue button at bottom right. Review uses Validate without importing as a secondary action and Import N users as primary. Show row-level errors directly under their summary count. “Save draft” is a proposed capability only if non-secret metadata can be saved safely; never persist raw credential files casually.

### Mobile arrangement

Use a compact “Step 2 of 4 — File” heading with a small progress indicator. Mapping becomes stacked source-field/target-field pairs with sample values. Put Back and Continue in a sticky bottom row without covering errors.

### Buttons, dialogs and states

Opening another import while a draft exists asks Keep editing/Discard setup. A started job uses a progress page with job ID, processed/failed counts, timestamps and safe navigation away. Result actions: Download error report, Retry failed rows if supported, and View imported users.

## Findings and fixes

### P1 — The result is simulated, not a migration

The page parses/analyzes files locally, but run() passes summary analysis into a placeholder job. Duplicate and verification choices are not a completed backend import contract. Keep this explicit until a real server job receives the source, mapping, options and records.

### P1 — Password continuity is too broad in the opening promise

“Nobody is asked to reset” is conditional on source exports and supported hashes. Show a source-specific checklist before upload and a review count for accounts that retain a password, need reset, lack an identifier or conflict.

### P1 — Long work needs recoverable progress

A modal-like interruption is avoided by the inline wizard, which is good. Preserve the draft on accidental navigation, explain replacement of the selected file, and let a started server job be reopened independently of the tab. Never store raw password exports in browser persistence by default.

### P2 — Large files need an honest loading/error model

ImportDropzone reads the whole file and shows a binary progress transition. No file-size guard or file-read recovery is visible in that path. State accepted formats/size, use indeterminate parsing progress, and surface malformed-row errors with downloadable reports when implemented.

## Proposed page

Import history and a single Start import action → Source → File and hash prerequisites → Map fields → Review impact → Validate file → Import → durable result. Hide decorative zero metrics on a first visit.

## Dialogs and interactions

The wizard is inline, not a v-dialog. Keep Back/Continue labels consistent, show the project on Review, describe whether duplicate “Update” can overwrite verified identity or metadata, and explain that validation writes no users.

## Acceptance checks

Use synthetic files containing a duplicate, bad phone, unsupported hash and missing email. Verify counts reconcile, dry-run creates no users, and a failed job can be investigated after navigating away.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md). Findings describe the current prototype; proposed behavior requires implementation and usability validation.

## Implementation references

- [imports.ts](../apps/client/app/stores/imports.ts)
- [import.ts](../apps/client/app/utils/import.ts)
