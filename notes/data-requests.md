# Data requests

Route: `/data-requests` · [Page source](../apps/client/app/pages/data-requests.vue)

## User task

I need to record a request, verify the subject, meet its deadline and retain evidence of the response.

## Keep

Keep a deadline-ordered queue, overdue counters and request-type distinctions.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Data requests                                      [+ Log request]
[Overdue N] [Due within 7 days N] [Open N] [Closed N]
[Search subject/reference.....................] [Type v] [Owner v]
[Subject | Request type | Stage | Deadline | Assigned to | Open]
[Selected request detail]
[Received at / source / verified subject / rule + due date]
[Timeline: intake -> verify -> process -> respond -> complete]
[Evidence / job status / response record]
[Record refusal...]                     [Next valid action]
```

Put Log request upper right; urgent counters filter the queue. Sort open requests by deadline. Detail shows original receipt and identity-verification status before execution controls. Only the valid next action is primary: verify subject, prepare export, review erasure, record response or close. Refusal is secondary and requires recorded grounds.

### Mobile arrangement

Use request cards with subject, type, stage and deadline. Detail is a separate full-height view; keep due date visible near the title and Next action sticky at bottom. Long legal/reference explanations remain expandable.

### Buttons, dialogs and states

Intake fields in order: request kind, subject search/unresolved state, original received date/time, source/reference, assignment, due-date explanation. Footer Cancel / Log request. Erasure execution is a separate destructive confirmation; logging never performs erasure. Failed jobs remain open with Retry/Investigate.

## Findings and fixes

### P1 — The deadline is computed from dashboard entry, not original receipt

The intake form is intended for requests arriving elsewhere but only captures a subject, kind and requestedBy. The store sets requestedAt to now. Add original received date/time and source reference; otherwise entering yesterday's email today silently moves the deadline.

### P1 — A fixed 30 days is presented as the statutory rule

The form and page make that claim categorically. GDPR Article 12(3) says one month from receipt and provides qualified extension rules, so calendar months and fixed 30-day intervals are not interchangeable. Model the applicable rule, due date and audited extension process with qualified review. See [the GDPR text](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

### P1 — Mark completed and Refuse bypass the evidence journey

DataRequestDetailDialog offers both actions directly; the sample store merely changes state and invents an export URL. Completion should come from a completed job/recorded response, and refusal needs a reason and communication record. Never equate a changed badge with performed erasure.

### P2 — Intake uses jargon and exact matching

“Whose data” requires an exact existing address/ID and “Who took it down” uses a support-ticket placeholder. Use a subject search with explicit confirmation, Request source/reference, Received at and Assigned owner. Allow an unresolved subject to be recorded for verification rather than silently losing intake.

## Proposed page

Work queue → request detail with timeline, deadline and assigned owner → identity verification → execution/response evidence → complete. Put policy explanations behind contextual help.

## Dialogs and interactions

DataRequestLogDialog: distinguish logging from executing; show proposed due date and rule. DataRequestDetailDialog: use “Prepare export,” “Review erasure” and “Record response” as appropriate, not one generic completion button. Permanent operations require a subject-specific impact review.

## Acceptance checks

Log a request received several days ago and check the correct due date. Refuse only with recorded grounds. Fail an export job and retain an open actionable request; expiry of a download must not erase completion evidence.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [DataRequestLogDialog.vue](../apps/client/app/components/DataRequestLogDialog.vue)
- [DataRequestDetailDialog.vue](../apps/client/app/components/DataRequestDetailDialog.vue)
- [data-requests.ts](../apps/client/app/stores/data-requests.ts)
- [users.ts](../apps/client/app/stores/users.ts)
- [data-requests.ts](../apps/client/app/utils/data-requests.ts)
