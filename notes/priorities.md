# Recommended implementation order

Priorities here are UX/product-impact priorities, not security vulnerability scores. P1 means a confusing or false outcome that can block the main task, lose work or create a consequential mistake. P2 means a meaningful clarity/efficiency improvement. Complete backend work may be necessary before a UI promise is honest.

## 1. Correct trust-breaking behavior

| Work item | Page notes | Definition of done |
| --- | --- | --- |
| Preserve email drafts across close/language/navigation | [Templates](email-templates.md) | No silent loss; explicit publication state |
| Stop inferring safe API-key rotation from last use | [Keys](keys.md) | Old/replacement pair is explicit; observation limits stated |
| Replace simulated success with capability-backed state | [Security](security.md), [SMS](sms-providers.md), [Account](account.md) | A fixture switch cannot imply working protection or payment |
| Clarify project/organisation/account scope | [General](settings.md), [Members](settings-members.md), [Billing](settings-billing.md) | Every consequential action names its real scope |
| Repair copied integration examples and missing destinations | [Webhooks](webhooks.md), [Step-up](mfa-step-up.md), [Second factor](auth-two-factor.md) | Samples work against real contracts; recovery link has a destination |
| Give dialogs names and explicit successful-save outcomes | [Dialogs](dialogs.md) | Accessible names and retained input after failure |
| Correct request intake/deadline/completion model | [Data requests](data-requests.md) | Original receipt, governing rule, evidence and execution remain distinct |

## 2. Make core customer journeys work

### First successful sign-in

Overview setup → API key → SDK → method/provider → app origin → custom domain if needed → verified test sign-in. Maintain project context and show one next action. The success event, not manually checking a box, completes onboarding.

### Customer cannot sign in

Users search → user detail → status/methods/factors → sessions → related signal/audit → proportionate action. Returning restores the initial search. Do not require memorizing an ID between pages.

### External service connection

Select provider/domain/endpoint → prerequisites → fields/DNS → validate → explicit activation → observable health. Keep secrets one-way and reveal once when appropriate. A successful configuration save is not a successful delivery test.

### Cost investigation

Usage period → quantity/rate/rounding → billing entity → invoice/payment status. Keep forecasts and vendor-direct charges separate from confirmed Idenzy charges.

## 3. Apply the page-family layouts

Implement the [layout blueprint](layout-blueprint.md) using the current design system. Pilot four different families: Users (investigation), Passwords (policy), Auth domains (setup) and Email templates (editor). Validate those with representative users before spreading the patterns across all pages.

Avoid a wholesale visual restyle first. A new palette will not fix draft loss, contradictory scope or a dangerous rotation recommendation.

## 4. Validate and refine

Use unfamiliar developers for setup, support staff for account investigation, and billing owners for cost comprehension. Ask each person what an action will do before they press it. Record incorrect predictions, failed tasks and recovery effort.

Run the acceptance checks in each page note, then verify keyboard navigation, screen-reader naming, error announcements, mobile/zoom layout and both themes. The current audit observed local prototype behavior; production permissions, failures, integrations and job completion still need verification against a connected backend.
