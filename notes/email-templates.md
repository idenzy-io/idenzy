# Email templates

Route: `/email/templates` · [Page source](../apps/client/app/pages/email/templates.vue)

## User task

I need to change transactional email copy, verify language fallback and publish without losing edits.

## Keep

Keep the built-in catalogue, live preview, variable list and HTML/plain-text pairing.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Email templates                        [Recipient language v]
[Search message........................] [All | Custom | Built-in]
[Message | Effective language | Status | Rendered subject | Edit]

Editor:
[< Templates] Reset password / English  [Unsaved] [Revert] [Publish]
[Language list, 2 cols] [Content, 5 cols] [Preview, 5 cols]
[+ Add language]        Subject          [Desktop | Mobile]
                       HTML / Plain text
                       [Insert variable]
[Validation: missing variable / compilation state]
```

Make Edit a visible row action. The workspace toolbar names both message and language. Keep Publish at upper right; Revert is a quieter separate action with a confirmation. Use HTML/Plain text tabs instead of always stacking two long textareas. Put Insert variable beside the active body editor and preview mode at the preview header.

### Mobile arrangement

Use Content / Preview tabs and a language selector above them. Keep unsaved state and Publish in a sticky footer. Preview has a selectable email viewport, independent of the dashboard device width.

### Buttons, dialogs and states

Add language can be an inline selector. Changing language with a draft preserves it or asks Save / Discard / Keep editing. Reverting shows the fallback version before confirmation. Generating plain text asks before overwriting manually edited text.

## Findings and fixes

### P1 — Closing the editor loses unsaved work

Browser check: change a subject, press Escape and reopen; the original subject returns without a confirmation. EmailTemplateDialog also reloads its draft on language changes. Preserve per-language drafts and intercept close, locale switch, project switch and navigation when dirty.

### P1 — A content workspace is compressed into a modal

The editor contains locale management, three bodies, preview, variables and reversion. Give it a dedicated page or full-screen editing workspace with a durable URL, sticky Save status and a clear return to the catalogue.

### P1 — Saved and delivering are separate states

Compilation and fallback can mean a saved template is not the one being sent. Show Draft → Saved/compiling → Active, and explicitly name the effective locale/template in the preview. Errors should preserve the last working version.

### P2 — Catalogue terms make the user translate

“Yours,” “Copy in use” and “Reader's language” require interpretation. Use Custom, Built-in, Unavailable, and “Preview recipient language.” Provide a rendered subject/message preview rather than only variable-rich source strings.

## Proposed page

Message catalogue → message/locale workspace → content and responsive preview → variable validation → publish/result. Show test-message delivery as a separate, permission-checked action when supported.

## Dialogs and interactions

EmailTemplateDialog is the main redesign candidate. Keep sandboxed preview isolation. “Draft from the HTML” should warn before overwriting edited plain text. Revert should show the effective built-in fallback and require a decision when it removes custom work.

## Acceptance checks

Edit English, switch language, close/reopen and navigate away: no silent loss. Break a variable and see an actionable validation error. Confirm active sending state after compilation, including fallback for an untranslated locale.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [EmailTemplateDialog.vue](../apps/client/app/components/EmailTemplateDialog.vue)
- [email-templates.ts](../apps/client/app/stores/email-templates.ts)
- [email-templates.ts](../apps/client/app/utils/email-templates.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
