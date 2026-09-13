# Webhooks

Route: `/webhooks` · [Page source](../apps/client/app/pages/webhooks.vue)

## User task

I need reliable event notifications and a way to diagnose or replay a failed delivery.

## Keep

Keep endpoint/event selection, delivery-attempt history and the distinction between asynchronous webhooks and synchronous hooks.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Webhooks                                             [+ Add endpoint]
[Endpoint | Enabled state | Delivery health | Last attempt | Manage]
[Selected endpoint]
[URL + subscribed events]                         [Edit] [Send test event*]
[Failed / Pending / Delivered] [Period v]
[Attempt | Event | HTTP result | Duration | Next retry | Details]
[Attempt detail: request metadata / safe response excerpt / history]
[Retry delivery*]                           [Signing settings / Rotate secret]
```

Put Add endpoint in the header. Each endpoint has a visible Manage action; its detail owns Edit and Send test event. Show failures before raw signature documentation. Attempt detail includes a Retry delivery action only when replay semantics are defined. Rotation is in signing settings, not beside everyday URL editing.

### Mobile arrangement

Use endpoint cards and a full-height attempt detail sheet. Keep event/outcome/next retry visible in the row. Put Retry at the bottom of the attempt detail, with the stable delivery ID shown above.

### Buttons, dialogs and states

Endpoint dialog: URL → event groups → example payload → initial enabled state → Cancel / Save endpoint. One-time secret reveal follows real creation, with copy/exit safeguards. Remove dialog: Pause endpoint as a safer alternative, queued-event behavior, Cancel / Remove endpoint.

## Findings and fixes

### P1 — The copyable verifier contradicts its own header example

The sample header contains sha256=… but the Node example compares the whole header against a plain hexadecimal digest. Its timingSafeEqual call also lacks a length check. Provide a tested SDK-based example or correct parsing/validation before customers copy it; a setup experience fails when its happy-path example cannot verify its own documented request.

### P1 — Signing-secret claims need an actual delivery design

The UI says the service keeps only a hash of an HMAC signing secret, yet generating future HMAC signatures requires usable signing key material. The delivery pipeline is unfinished. Resolve custody and rotation on the backend before promising shown-once storage and a one-day overlap; distinguish inability to re-reveal from inability to sign.

### P1 — Attempt history lacks a complete troubleshooting workspace

A status code alone is insufficient. Offer endpoint-scoped details with safe response excerpt, timestamps, duration, next retry, delivery ID and redacted request payload. A test event should prove reachability and verification before activation.

### P2 — Retry and disabled-endpoint behavior needs concrete recovery

Show why an endpoint is disabled, what happens to queued/missed events, whether resuming replays anything, and the difference between retrying an existing delivery and creating a new test event. Do not promise ordered or exactly-once delivery.

## Proposed page

Endpoint list with health → endpoint detail and test → recent failures/retry schedule → request/response evidence → signing and event reference.

## Dialogs and interactions

WebhookEndpointDialog: URL, event groups with descriptions and a sample event. WebhookSecretDialog: explicit rotation deadline and signing/verification behavior, plus a safe exit. WebhookRemoveDialog already offers disabling; preserve that distinction and explain queued-event impact.

## Acceptance checks

Verify the documented sample end-to-end, including malformed signatures. Add/test an endpoint, inspect a failure, replay safely and see the stable delivery identifier. An unavailable pipeline cannot claim a successful delivery.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Settled while implementing

- **Delivery runs, and the page is a diagnostics screen rather than a form.** The relay fans events
  out, the dispatcher signs and sends, failures come back on the published schedule, and the table
  holds real attempts (ADR-0012). What is still off is `testEvent` and `replay`, each its own flag on
  `WEBHOOK_DELIVERY` so a control is disabled for its own reason rather than for delivery's; the strip
  above the list names the two rather than claiming nothing is sent.
- **The figures are counters, not a count of the deliveries on screen.** The table holds the latest
  fifty per endpoint, so counting it would report a busy week as fifty — less true the more traffic a
  customer has. `webhook_endpoint_stats` is a row per endpoint per day and the strip reads it, which
  is also why `Waiting to retry` gave its tile to `Attempts`: a count of deliveries between attempts
  is a live number rather than a day's total, and it is already the pending tab below.
- **The verifier sample is a call, which is the first finding answered properly.** It was thirty lines
  of hand-written HMAC that disagreed with the header it documented; correcting it would have left a
  second implementation to keep in step with the signer. It is now `verifyWebhook` from
  `@idenzy/node`, tested where it lives and against the real signer over a socket in `apps/workers`.
- **A pause says whether the reader made it.** The API answers the membership id rather than a name,
  so the row reads "By you" or "By a team member" — resolving a person belongs to the members screen,
  and a name copied here would be a second place it has to be kept true.
- **The breaker counts failed attempts, not failed deliveries.** A delivery only dies after every
  attempt on the schedule, so twenty of those would be weeks of calling an endpoint that has never
  answered. The wording on the row changed with it.
- **Event groups are an accordion,** at the user's request: the first group open, any number
  open at once, a line per group, a group checkbox, and a count on each folded header.
- **A new endpoint starts off unless somebody ticks otherwise,** which is the initial enabled
  state above: a test event should come before real ones.
- **A rotation asks first and names its deadline,** in a dialog of its own; the secret dialog
  repeats it and has a safe exit. Custody is stated as unsettled rather than promised.
- **A row is a delivery, with its attempts in the detail.** The table shows each delivery's latest
  attempt, the latest fifty in the period, with no pager.
- **All of it is in the schema now:** the description, the all-events choice, why an endpoint is off
  and who switched it off, the rotation fields, and an attempt's duration, answer and next retry. The
  store reads and writes them through the management API, and the shapes the panel modelled are the
  ones it answers.
- **Observed delivery leads as a figures strip,** at the user's request, as on the allowed origins
  screen: deliveries, delivered, failed and waiting to retry over seven days, each reading No data
  while nothing is delivered.

## Implementation references

- [WebhookEndpointDialog.vue](../apps/client/app/components/WebhookEndpointDialog.vue)
- [WebhookSecretDialog.vue](../apps/client/app/components/WebhookSecretDialog.vue)
- [WebhookRemoveDialog.vue](../apps/client/app/components/WebhookRemoveDialog.vue)
- [webhooks.ts](../apps/client/app/stores/webhooks.ts)
- [webhooks.ts](../apps/client/app/utils/webhooks.ts)
