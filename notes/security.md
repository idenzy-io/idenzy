# Security center

Route: `/security` · [Page source](../apps/client/app/pages/security.vue)

## User task

I need to decide which signals require investigation, distinguish evidence from a proven compromise, and respond safely.

## Keep

Keep priority-ranked evidence, acknowledgement versus dismissal, and the caution that unusual travel does not prove takeover.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Security center                         [Investigate] [Detection settings]
[Act now N] [Review N] [Recorded N]                [Period v]
[Search/filter................................] [Export view]
[Signal queue, 5 cols]                  [Selected signal, 7 cols]
[Type | Account | Priority | Age]        Evidence + uncertainty
                                        Related user / sessions / audit
                                        Decision history
                                        [Acknowledge] [Dismiss] [Respond...]
[Detection settings: detector | actual enforcement | Manage]
```

Use tabs to separate investigation from configuration. The queue's counts share its exact time/filter scope. Select a row to show evidence first, followed by explanation and related sessions; put response actions at the detail footer. Acknowledge is neutral, Dismiss is secondary, and a session-ending response opens its own specific confirmation.

### Mobile arrangement

Show queue first; tapping a signal opens a full-height detail view with Back to queue. Keep priority text and state with the title. Actions remain in a sticky footer while evidence scrolls.

### Buttons, dialogs and states

Dismiss dialog: signal/account, reason choices, optional explanatory note and Cancel / Dismiss signal. Rule changes show enforcement availability before Save. A missing detector backend cannot be labelled Enabled protection; show unavailable/setup-required with its next step.

## Findings and fixes

### P1 — The page promises protections not established by implementation

It offers automatic second-factor responses and describes Cloud Armor as Always, while Step-up and the service inventory mark relevant enforcement/infrastructure as unavailable. Label observed, configured and enforced separately; disable unsupported responses with a truthful explanation.

### P1 — The embedded challenge example disagrees with the protocol

The page shows status: challenge, while ADR-0010 defines authenticated/mfa_required outcomes. A developer copying the example could branch on the wrong value. Generate examples from protocol fixtures and keep operational response copy aligned.

### P1 — Counts do not tell a consistent story

The captured Personal Team list shows 10 open rows in its window while the metrics show 22 open signals. Either reconcile the data or label the separate scope/window explicitly. Do not use independent fixture totals as apparent measurements.

### P2 — Investigation and rule editing compete

The queue, charts and detector configuration share a long page. Separate Investigate from Detection settings; make a signal's detail show evidence, innocent explanations, related sessions and the effect of each response.

## Proposed page

Triage queue → selected signal detail → related account/session activity → decision history. Detector settings live in a secondary tab with enforcement/readiness status.

## Dialogs and interactions

SignalDismissDialog should keep its reason choices and identify the specific signal. Use “Dismiss signal,” not language implying the account is now safe. NumberDialog needs units and scope. Signing out should show affected sessions and actual propagation behavior.

## Acceptance checks

Trace a signal to the relevant person and session. Dismiss it without implying a detector was disabled. Every selectable automated response has an implemented enforcement path, and counts reconcile within the chosen scope.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [NumberDialog.vue](../apps/client/app/components/NumberDialog.vue)
- [SignalDismissDialog.vue](../apps/client/app/components/SignalDismissDialog.vue)
- [security.ts](../apps/client/app/stores/security.ts)
- [users.ts](../apps/client/app/stores/users.ts)
- [sms-policy.ts](../apps/client/app/stores/sms-policy.ts)
- [filters.ts](../apps/client/app/utils/filters.ts)
- [metric-chart.ts](../apps/client/app/utils/metric-chart.ts)
- [security.ts](../apps/client/app/utils/security.ts)
- [sms-policy.ts](../apps/client/app/utils/sms-policy.ts)
- [users.ts](../apps/client/app/utils/users.ts)
