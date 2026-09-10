# Claim templates

Route: `/tokens/claims` · [Page source](../apps/client/app/pages/tokens/claims.vue)

## User task

I need to add authorization data to tokens without leaking private metadata or breaking sign-in.

## Keep

Keep the dedicated draft/save model, sample payload, reserved-name checks, byte budget and private-metadata acknowledgement.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Claim templates                      [Unsaved: 2] [Discard] [Publish template]
[Mappings editor, 7 cols]                 [Token preview, 5 cols]
[+ Add claim]                            [Sample user v]
[Name | Source -> key | Required | Edit]  [Before / After]
[... mappings ...]                       [Missing/oversized warning]
                                         [Custom bytes: 620 / 1024]
[Validation results and affected sample profiles]
[Technical limits v]
```

Use a persistent editor toolbar. Put Add claim immediately above the mapping list, distinct from Publish template at the page's upper right. Required is a visible per-row control with its failure consequence nearby. Keep budget and validation beside the token preview; block publication only for real validation failures and explain them.

### Mobile arrangement

Stack mapping list and preview behind Editor / Preview tabs with a visible unsaved badge. Keep Publish in a sticky bottom action row and make preview errors visible on both tabs.

### Buttons, dialogs and states

Add-claim dialog: source → field/key → claim name → required choice → one-line rendered preview → Cancel / Add to draft. Publish-private-data dialog names each private source key and its exposure, with Keep editing / Publish template. Leaving a dirty editor requires an explicit decision.

## Findings and fixes

### P1 — Add versus publish is not explicit enough

Add claim closes its dialog after editing a local draft; only Save template persists the whole template. Use “Add to draft,” a persistent unsaved count and a before/after preview. This page should clearly differ from autosaving policy screens.

### P1 — Required can cause an authentication outage

A missing required claim prevents issuance. Explain that consequence directly beside Required and preview a new/phone-only account as well as a complete profile. Offer a validation summary before publishing; a single synthetic complete profile cannot establish fleet-wide safety.

### P1 — Private-source disclosure needs concrete scope

The acknowledgement should name the exact mapped keys and explain they become visible to token recipients. Never imply a private source remains private because the JWT is signed. Preserve a single deliberate acknowledgement at publish.

### P2 — The editor has useful protection but incomplete exit coverage

The route-leave dialog is already present and should be kept. Verify browser refresh/close and project switching separately; drafts must stay bound to their originating project and never be saved into a different one.

## Proposed page

Two-pane editor: claim mappings and draft actions on the left; token diff, sample-user selector and budget on the right. Technical constraints live below the editor, not between the mapping and its result.

## Dialogs and interactions

ClaimAddDialog: map “Source → Field/key → Token claim name,” with “Add to draft.” ClaimAcknowledgeDialog: list exact private keys and their exposure. UnsavedChangesDialog: offer a clear Keep editing/Discard path, and Save and leave when valid. Never request a secret key in browser configuration.

## Acceptance checks

Add an optional metadata claim, switch sample to a missing field, then mark required and observe the blocked result. Cancel publication of private data without losing the draft. Change projects and verify isolation.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [ClaimAddDialog.vue](../apps/client/app/components/ClaimAddDialog.vue)
- [ClaimAcknowledgeDialog.vue](../apps/client/app/components/ClaimAcknowledgeDialog.vue)
- [UnsavedChangesDialog.vue](../apps/client/app/components/UnsavedChangesDialog.vue)
- [claims.ts](../apps/client/app/stores/claims.ts)
- [claims.ts](../apps/client/app/utils/claims.ts)
