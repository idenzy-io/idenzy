# Dialog and form review

## Why the dialogs are difficult

Many dialogs combine a short task with a substantial explanation of implementation or security philosophy. Titles are frequently 14px, help text 11–12px, and several actions say only “Change.” The user must reconstruct the affected resource, consequence and save model while the page behind the dialog is unavailable.

Use an inline editor for a reversible single value, a dialog for a focused decision, and a dedicated workspace for long content editing. A modal is not automatically safer.

## A consistent decision structure

1. Title names the action and resource: “Change passkey domain.”
2. Context names the project and current value.
3. Fields show examples, constraints and actionable errors.
4. Impact states who is affected and when.
5. Footer names the outcome: “Save domain,” “Revoke 3 sessions,” “Charge $50.00.”

Keep detailed protocol rationale behind an optional disclosure or a guide. An acknowledgement should state a specific consequence, not “I understand” without context.

## P1 — Saving is not the same as closing

Several simple dialogs emit an event and close immediately, including UserAddDialog, NumberDialog, PasskeyRpIdDialog and TotpIssuerDialog. Others close when busy changes from true to false, including ProviderSetupDialog and AccountPasswordDialog. Neither pattern proves success: the busy flag also becomes false after a failed request.

Define explicit pending, successful and failed results. Close only after confirmed success, preserve the draft after failure, show the server's safe error beside the relevant field, and provide retry without duplicate submissions. This is primarily a production integration requirement because current stores simulate success.

Claims “Add claim” modifies a draft; “Save template” persists the whole template. Label that intermediate action “Add to draft.” Do not make the first button look like publication.

## P1 — Protect actual work

EmailTemplateDialog reloads draft bodies on locale change and can dismiss on Escape without a dirty check. Its edit workspace needs per-language drafts and Save / Discard / Keep editing decisions when leaving. The claims page already has a route-leave guard and should retain it; browser reload/close remains a separate case to verify.

A one-time key reveal deserves protection from accidental dismissal. It also needs an honest deliberate exit for a user who cannot copy, plus instructions for replacement. Do not require someone to claim they stored a secret just to escape. Avoid browser persistence of revealed secrets.

## P1 — Destructive actions need resource-specific impact

| Dialog family | Required decision context |
| --- | --- |
| UserDelete / UserSuspend / SessionRevoke | Exact identity, selected count, scope, when access ends, recovery or irreversibility |
| ProjectDelete / AccountLeave | Project versus organisation, dependencies, ownership blocker and retained records |
| ProviderRemove / PasskeyRpId | Accounts losing a sign-in method and alternative access |
| OriginRemove / AuthDomainRemove | Exact host/origin, affected application and fallback limits |
| RecoveryClear | Remaining codes invalidated, user still owns factor, safe recovery route |
| MemberRemove / MemberTransfer | Role before/after, who retains ownership, machine keys unaffected unless separately revoked |
| WebhookRemove / WebhookSecret / Hook endpoint removal | Pausing versus deletion, queued events, signature transition, effect on sign-in |
| SuppressionRelease / SignalDismiss | Evidence and reason; neither action proves the underlying problem is resolved |

Existing dialogs already include several of these safeguards. Preserve specific identity and consequence copy while trimming repeated technical justification.

## P1 — Accessible modal behavior

The rendered hook endpoint, account password, member invitation, project deletion, automatic top-up and password minimum dialogs have `role="dialog"` and `aria-modal="true"`, but neither `aria-label` nor `aria-labelledby`. Connect each visible heading with `aria-labelledby`; a visually present title does not by itself name the dialog. This was a DOM inspection, not a complete assistive-technology test.

Verify an accessible dialog name, focus entry, contained Tab navigation, Escape behavior, and focus return to the trigger. Inputs need programmatically associated help and errors; nearby small paragraphs alone may not be announced. Test nested menus and the one-time reveal exception explicitly. The [WAI-ARIA modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) describes the expected behavior.

At narrow widths, keep the title, focused field and actions reachable with the on-screen keyboard open. Scroll the body of long dialogs and keep the action row visible. Do not assume that a maximum width makes a dialog mobile-safe.

## Proposed acceptance scenarios

- Submit an invalid URL: explain the problem before or on submit, with focus at the problem.
- Save fails: dialog stays open, input survives, error is announced.
- Switch email language with a draft: changes are preserved or an explicit decision is required.
- Revoke from a filtered list: confirmation identifies exactly what is selected.
- Keyboard-only user can enter, complete/cancel and return to the trigger.
- A destructive action never reports completion merely because a timer finished.

Page notes name their related components and include task-specific copy and flows.
