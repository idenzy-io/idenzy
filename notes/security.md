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

## Settled while implementing

- **Investigating and configuring are two tabs.** They competed for one long page, and they
  are not the same job: a queue is worked down and a detector is changed once. The tab is in
  the query so a screen somebody is asked to look at can be linked to, replaced rather than
  pushed.
- **The counts are the queue's own rows.** The strip said twenty-two open over a list of ten
  because the figures came from the project's totals and the list came from the window. One
  source now: `Act now / Review / Recorded`, computed from exactly the rows on screen, with
  "in this view, last 30 days" beside them.
- **Observed, configured and enforced are three columns.** `RESPONSE_ENFORCEMENT` says what
  each response actually does today — only `Record it` is carried out — and `detectorStatuses`
  reports the three separately. A rule set to something the deployment cannot do says so on
  its own row, in the warning ink, with a link to where the missing half is built. A badge
  counts them.
- **The sample is the protocol's own union.** It said `status: "challenge"` with a `reason`
  field, and neither exists: `authOutcomeSchema` discriminates between `authenticated` and
  `mfa_required` (ADR-0010) and the challenge carries `challengeId`, `purpose`, `factors` and
  `expiresAt`. Mirrored into `utils/security.ts` with the source named, the way `keys.ts`
  mirrors the key kinds, and pinned by a test.
- **"Always" is gone from the defences that are not running.** Cloud Armor is designed and
  not provisioned, so it reads `Not provisioned` beside the three that read `Running`. An
  unfalsifiable claim about the edge is one that is only tested during the incident it was
  meant to cover.
- **The queue is the panel's list surface and the detail is a dialog over it.** The mockup
  draws a five-column queue beside a seven-column panel; built, five columns left nowhere to
  put the account a row is about, which is the column an operator traces a signal by. So the
  table has the page — sorting, paging, the column menu, the arrangement a reader keeps — and
  reading one signal is `SignalDetailDialog`, the way every other detail in this panel opens.
  The signal cell is the way in, as a person's name is on the users list, and the ellipsis
  keeps the less frequent actions.
- **Inside the detail: evidence, then what else it could be, then the person and their
  sessions and the audit log, then what has already been decided, then the actions.** The
  evidence and the uncertainty are set at the same size and in that order, because a panel
  that led with the finding and put the innocent explanation in small print would be making
  the opposite argument in the layout.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [NumberDialog.vue](../apps/client/app/components/NumberDialog.vue)
- [SignalDetailDialog.vue](../apps/client/app/components/SignalDetailDialog.vue)
- [SignalDismissDialog.vue](../apps/client/app/components/SignalDismissDialog.vue)
- [security.ts](../apps/client/app/stores/security.ts)
- [users.ts](../apps/client/app/stores/users.ts)
- [sms-policy.ts](../apps/client/app/stores/sms-policy.ts)
- [filters.ts](../apps/client/app/utils/filters.ts)
- [metric-chart.ts](../apps/client/app/utils/metric-chart.ts)
- [security.ts](../apps/client/app/utils/security.ts)
- [sms-policy.ts](../apps/client/app/utils/sms-policy.ts)
- [users.ts](../apps/client/app/utils/users.ts)
