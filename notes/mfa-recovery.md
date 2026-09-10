# Recovery codes

Route: `/mfa/recovery` · [Page source](../apps/client/app/pages/mfa/recovery.vue)

## User task

I need to find customers at risk of losing access and guide them to replace their own recovery codes.

## Keep

Keep the default Out of codes view, counts, distinction between no sheet and an exhausted sheet, and prohibition on staff generating another person's secrets.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Recovery codes                                     [Recovery guide]
[Out of codes N] [Low N] [All enrolled accounts N]
[Search account........................] [Warning threshold: 3 v]
[Account | Remaining | Authenticator/passkey | Last generated | View]
[Selected account detail]
  No recovery codes remaining
  [Open user] [View replacement instructions] [Notify user*]
  [Advanced: invalidate remaining codes]
```

Put the risk segments and search above the list. The initial action for an exhausted account is instructions/user context, not Clear. Keep threshold control secondary at the list's top right and label it as a dashboard warning preference. If notifications are built, show recipient/channel and audit the send; the mockup does not imply that feature exists.

### Mobile arrangement

Rows show account, remaining count and factor availability. Tapping opens a full-height detail sheet with instructions before advanced actions. Do not rely on colour-only code pips.

### Buttons, dialogs and states

Threshold dialog: “Flag accounts with N or fewer codes,” bounded integer and Save warning threshold. Clear dialog: account + remaining count + factor remains + replacements must be created by the owner. Cancel / Invalidate N codes. For an exhausted set, explain that clearing does not restore access.

## Findings and fixes

### P1 — The queue identifies a problem but offers little safe resolution

The main mutation is clearing codes, which is not the remedy for a customer who already has none. Add a subject detail/instruction path explaining how the signed-in user generates replacements, and an optional audited notification workflow when implemented.

### P2 — ‘Sheet’ adds a vocabulary burden

Use “Recovery codes” or “Recovery set” consistently. Label 0/10 as “No codes remaining,” and retain a different state for “Never generated.” Explain whether the count includes only enrolled-factor accounts.

### P2 — The threshold looks like authentication policy

“Low at 3” is a dashboard alert threshold. Rename it “Flag accounts with 3 or fewer codes”; make clear that it changes this queue, not which codes work.

### P2 — Technical explanations outweigh the support task

The alphabet, digest choice and atomic use are reference material. Prioritize the affected people and the action they should take. Keep account identity/state visible on mobile rather than relying on the full table.

## Proposed page

Risk queue → selected account's factor/recovery context → safe instructions or notification → full history and optional format reference.

## Dialogs and interactions

RecoveryClearDialog already adapts acknowledgement to remaining codes; preserve that. Use “Invalidate remaining recovery codes,” name the account and count, and explain that the authenticator remains enrolled. NumberDialog changes the warning threshold only.

## Acceptance checks

Locate an exhausted set, identify the safe next step and avoid clearing it as a supposed repair. For a set with remaining codes, the confirmation states what is lost. No workflow reveals another user's codes.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [NumberDialog.vue](../apps/client/app/components/NumberDialog.vue)
- [RecoveryClearDialog.vue](../apps/client/app/components/RecoveryClearDialog.vue)
- [recovery.ts](../apps/client/app/stores/recovery.ts)
- [users.ts](../apps/client/app/stores/users.ts)
- [mfa.ts](../apps/client/app/utils/mfa.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
- [recovery.ts](../apps/client/app/utils/recovery.ts)
- [users.ts](../apps/client/app/utils/users.ts)
