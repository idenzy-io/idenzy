# Email templates

Routes: `/email/templates` · [catalogue](../apps/client/app/pages/email/templates/index.vue) and
`/email/templates/:type` · [workspace](../apps/client/app/pages/email/templates/[type].vue)

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

## Settled while implementing

**The editor is a route, not a full-screen overlay.** `/email/templates` is the catalogue
and `/email/templates/:type` is the workspace, with the language in `?lang` and replaced
rather than pushed: it is a view of one message and not a resource, and a reader who edited
four languages should not press Back four times to leave.

**Drafts live in the store rather than the page.** Keyed by project, message and language,
which is what makes them survive the language switch, the walk back to the catalogue and the
return, and what lets the catalogue mark a message as holding unpublished copy. They are
deliberately not persisted to browser storage.

**Publish writes every language with unsaved copy, not the one on screen**, and the button
counts them. Validation runs over all of them, and a fault in a language that is not on
screen is a page-level strip with the way to it, because the refusal would otherwise have no
visible cause. The mockup's single Publish is kept; what changed is its scope and its name.

**Add language stayed an inline selector, and gained a `Start from`.** A new language that
opened on a blank page is a translator asked to retype the markup, so it seeds from another
language that already has copy, or from the built-in.

**The catalogue's subject column is rendered rather than source**, with the template on
hover, and the filter says Custom / Built-in / Unavailable as the P2 finding asks. The
recipient-language control is named "Preview recipient language".

**Test-message delivery is present and switched off, with the reason at the point of use.**
There is no audited send behind it; a workspace that silently lacked the obvious action would
read as a missing feature nobody explained.

**The three fields are one editor.** A subject typed in an ordinary text input is the one
field where a mistyped variable is not marked, not completed and not explained, and it is
the field most often typed from memory. See CLAUDE.md for why that editor is CodeMirror.

## Acceptance checks

Edit English, switch language, close/reopen and navigate away: no silent loss. Break a variable and see an actionable validation error. Confirm active sending state after compilation, including fallback for an untranslated locale.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [index.vue](../apps/client/app/pages/email/templates/index.vue) — the catalogue
- [\[type\].vue](../apps/client/app/pages/email/templates/[type].vue) — the workspace
- [CodeEditor.vue](../apps/client/app/components/CodeEditor.vue)
- [EmailPreviewFrame.vue](../apps/client/app/components/EmailPreviewFrame.vue)
- [EmailLanguageList.vue](../apps/client/app/components/EmailLanguageList.vue)
- [EmailRevertDialog.vue](../apps/client/app/components/EmailRevertDialog.vue)
- [EmailPlainTextDialog.vue](../apps/client/app/components/EmailPlainTextDialog.vue)
- [TemplateVariableMenu.vue](../apps/client/app/components/TemplateVariableMenu.vue)
- [email-templates.ts](../apps/client/app/stores/email-templates.ts)
- [email-templates.ts](../apps/client/app/utils/email-templates.ts)
- [template-editor.ts](../apps/client/app/utils/template-editor.ts)
- [html-format.ts](../apps/client/app/utils/html-format.ts)
- [code-theme.ts](../apps/client/app/utils/code-theme.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
