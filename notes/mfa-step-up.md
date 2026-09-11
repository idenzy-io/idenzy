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

## Settled while implementing

The screen and the drawer are both called "Additional verification", and the title carries no
parenthetical. `PageHeader` truncates its one line, so the mockup's "(Step-up)" was what got
cut at 390px; the spec's own word opens the description instead, where it also reaches the
reader who searched for it. `notes/shared-experience.md` asks for this label by name, so the
navigation entry, the breadcrumb and the title now agree, and the two screens that pointed
here by the old name were updated with it.

The action matrix is three columns and not four. The setup link sits as the last line of
"What happens today" rather than in a column of its own: two of the five rows have no link,
and a fourth column mostly empty would have pushed the behaviour text into a width where it
scrolls sideways inside the card.

It has five rows rather than four, because "asking for the password again" is a row. It is
the honest fix for the accounts the coverage strip counts, and a screen that mentions it only
in prose invites the reading the note warns about; as a row marked `Not available` it cannot
be mistaken for something that exists.

The impossible-travel disagreement is resolved by naming the difference rather than by
softening either page. A detector rule answers the *sign-in* with a challenge, which is the
MFA gate and lives in the security centre; a step-up is a check inside a session that already
exists, and nothing raises one. The row says both halves and links to the screen that owns
the first.

The server half of the paired example is written against the project's own window, so the
number an operator just chose is the number in the code. Both halves say what their null
means, and the client's is checked with `!== null` rather than assumed.

"What a user runs into" is one person's afternoon and not a table of ages. Four rows of
"verified N minutes ago" against the window was the same fact said twice, and a reader could
check the arithmetic and still not know what the person on the other end sees. `walkthrough`
returns the sequence instead: the proof, an action inside the window, the same action past it,
and the answer that puts them back where they started, with the line the window draws rendered
between the second step and the third. Every age is derived from the window and every step's
freshness comes from `isProofFresh`, the same rule the server applies, so the story moves with
the control and cannot drift from the check it illustrates. The panel's foot carries the
coverage caveat again, because that is the one step a user without a factor never reaches.

One shared component changed: `SettingRow`'s text column now has a `basis-48` floor. With no
floor it shrank to nothing rather than letting the row wrap, so the four-option segmented
control this screen needs squeezed its own description into one word per line on a phone. The
floor is chosen against both ends: a switch still sits beside its text at 390px, and every
desktop row is unchanged.

## Acceptance checks

Compare an account with a factor to one without. Identify exactly which first-party action is enforced today. Ensure dashboard copy and the client/server examples do not recommend treating a missing proof as sufficient.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [SettingRow.vue](../apps/client/app/components/SettingRow.vue)
- [mfa.ts](../apps/client/app/stores/mfa.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
- [step-up.ts](../apps/client/app/utils/step-up.ts)
- [users.ts](../apps/client/app/utils/users.ts)
