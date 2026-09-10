# Additional verification (Step-up)

Route: `/mfa/step-up` · [Page source](../apps/client/app/pages/mfa/step-up.vue)

## User task

I need to protect sensitive actions and know which people will actually be challenged.

## Keep

Keep the acknowledgement of the no-factor limitation and the sample token, but present them in task order.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Additional verification (Step-up)
[Coverage: users with factors | users without factors]
[Limitation: accounts without a factor are not challenged here]
[Ask again after: 5m | 15m | 30m | 60m]
[Example: verified 20 minutes ago -> another check required]
[Action | Enforced by | Current behavior | Setup link]
[Email change | Idenzy | ...]
[Your sensitive action | Your server | ...]
[Client + server example v]                         [Save window]
```

Place the coverage limitation above the freshness choice, not in a side note. Keep Save window beside the changed setting, with the before/after value and application timing. Put custom integration examples below the action matrix and show the server check adjacent to the client challenge call.

### Mobile arrangement

One column with coverage cards stacked and matrix rows expanded into action summaries. Keep the no-factor limitation visible before the user changes the window.

### Buttons, dialogs and states

No modal for changing a small reversible window. Show inline Save/Cancel and pending/error state. A future enforcement upgrade should use a separate setup journey listing unenrolled users, rather than adding a misleading Require everybody switch.

## Findings and fixes

### P1 — The page can overstate effective protection

A 15-minute window sounds like enforcement for everyone, while an account with no second factor passes the current first-party gate. Put this limitation beside the setting and show coverage, not deep in explanation. Do not imply password re-authentication exists.

### P1 — Protection claims disagree with other pages

Security offers an impossible-travel challenge response, while this page says such triggers are not yet enforced. Factor removal is also explicitly not server-gated here. Define an action matrix: enforced today, SDK guidance, custom application responsibility, unavailable.

### P1 — The client/server examples need one contract

The page distinguishes a null startStepUp result from missing fva in server verification; casual readers may collapse both into “allow.” Put complete paired examples together and use the actual SDK contract. Verify freshness ages correctly as time passes after token issuance.

### P2 — A one-setting page is excessively large

The challenge mechanics and claim definitions dominate a page with one editable window. Start with “Ask again after 15 minutes,” affected actions and coverage; move challenge storage/HTTP details into reference.

## Proposed page

Protection coverage summary → freshness window with user-visible example → action-by-action enforcement matrix → optional implementation example.

## Dialogs and interactions

No page-specific dialog. The window can remain an inline choice with local saved/error feedback. Copy example: “Ask for another verification when the last successful factor check is older than 15 minutes.”

## Acceptance checks

Compare an account with a factor to one without. Identify exactly which first-party action is enforced today. Ensure dashboard copy and the client/server examples do not recommend treating a missing proof as sufficient.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [mfa.ts](../apps/client/app/stores/mfa.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
- [step-up.ts](../apps/client/app/utils/step-up.ts)
