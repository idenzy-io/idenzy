# Passwords

Route: `/methods/passwords` · [Page source](../apps/client/app/pages/methods/passwords.vue)

## User task

I need to choose a password policy and understand its effect on current and future users.

## Keep

Keep secure defaults, the plain-language requirements preview and preservation of hashes when a method is disabled.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Passwords                                  [Available / Disabled]
[Password sign-in: switch] [Allow new password accounts: switch]
[Password requirements, 8 cols] [What users must enter, 4 cols]
  Minimum length [ 12 ] characters
  Breach check   [On]
  [Cancel changes] [Save requirements]
[Reset & sessions: 15-minute link | sign out other devices]
[Failed-attempt controls v]    [Advanced implementation details v]
```

Keep the method switch near the title, with its effect immediately below. Minimum length is an inline field; put Save requirements at that section's bottom right and Cancel changes to its left. Show the saved value in closed section headings. Reset duration and sign-out behavior are a second logical group; avoid one save per keystroke.

### Mobile arrangement

Stack the requirements preview immediately below its editor. Use full-width labels and controls, with the save row after that section. Keep the disable-impact warning above confirmation, never in a right sidebar.

### Buttons, dialogs and states

Disable confirmation: project → number of password-only accounts → remaining methods → Cancel / Disable password sign-in. Inline validation names the valid length bounds. Lockout enablement gets its own focused impact review because it can be abused to deny access.

## Findings and fixes

### P1 — Turning off sign-in is easier than understanding its effect

A switch saves immediately, while the explanation requires reading about endpoints and hashes. Show affected password-only accounts and alternative methods before disabling. Use stronger confirmation only when people could lose access.

### P1 — Policy values disagree across the console

The page offers reset lifetime changes, but Lifetimes calls password reset a deployment-fixed value. AccountPasswordDialog's shared strength meter describes character mixing under “Must contain,” while this page says no composition rules. Agree on one effective policy and separate suggestions from requirements.

### P2 — Collapsed sections conceal the current policy

Requirements, Failed attempts and Reset/change initially collapse without key values in their headers. Add summaries such as “12 characters · breach check on” and “15-minute reset link · other sessions end.”

### P2 — One number does not need a reading-heavy modal

NumberDialog is reusable but generic. Consider inline numeric editing with explicit Save/Cancel; if retained, give it “Save minimum length,” visible bounds and a sentence explaining when the change applies.

## Proposed page

Status with affected-user context → requirements editor and preview → reset/session policy → advanced failed-attempt settings. Move hashing, normalization and rate-limit internals to reference help.

## Dialogs and interactions

NumberDialog covers minimum length and lockout attempts. Keep units visible, preserve input on failed save, and warn specifically before enabling lockout. Do not present an absent save error as success via a page-footer timestamp.

## Acceptance checks

Raise the minimum, open Add user, and confirm the same requirement. Disable password sign-in on a project with password-only users and see their impact before committing. Closed sections still reveal the saved values.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md). Findings describe the current prototype; proposed behavior requires implementation and usability validation.

## Implementation references

- [NumberDialog.vue](../apps/client/app/components/NumberDialog.vue)
- [password-policy.ts](../apps/client/app/stores/password-policy.ts)
- [password-policy.ts](../apps/client/app/utils/password-policy.ts)
