# SMS providers

Route: `/sms/providers` · [Page source](../apps/client/app/pages/sms/providers.vue)

## User task

I need to choose managed delivery or my own vendor and understand the real cost and readiness.

## Keep

Keep the distinction between Idenzy routing and a customer-owned account, and preserve fraud policy across both.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
SMS delivery providers
[Idenzy-managed delivery]        [Use my provider account]
  Estimate / availability        Vendor / billing owner / readiness
                                 [Connect account / Manage]
[Destinations: Allowed first v] [Search country..............]
[Country | Price per segment | Route ready? | Registration | Action]
[Vendor catalogue and rate assumptions v]

  ... delivery health is a figures strip and leads the page, under the title.
```

Make delivery mode a clear two-option comparison instead of an unexplained segmented switch. Put Connect account inside the own-account panel. Managed delivery shows actual availability and billing ownership. The country table filters to the project's allowed destinations first; missing registration gets a specific setup link.

### Mobile arrangement

Stack the two mode options with the selected state visible. Country rows become summaries of country, price unit and blocker. Keep registration explanations available without hover.

### Buttons, dialogs and states

Own-account dialog order: vendor → account identifier → secret/replacement behavior → sender requirements if applicable → Verify credentials → activation result. Footer Cancel / Verify account, then Use this account after success. Display vendor-direct charges and retained fraud controls before activation.

## Findings and fixes

### P1 — Vendor status is demonstrably misleading

The page labels Twilio and AWS as Carrying traffic, but the service inventory says vendor adapters are port-only and the real development transport logs messages. Gate status on actual deployed capability and keep illustrative routes separate from live traffic.

### P1 — The unit changes between prose and table

Copy says per segment, while the rate column says Per message. Use “Price per segment,” explain encoding/multipart effects and label rates as examples until backed by the actual pricing source. Do not infer a guaranteed bill from message count alone.

### P1 — Own-account setup lacks a verification stage

SmsAccountDialog collects account credentials and switches carriage. Add a credential check and a deliberately initiated test, then activate only when valid. Explain vendor-side charges even when the Idenzy carriage line is zero.

### P2 — A global routing catalogue obscures the project's destinations

Show allowed countries first, with route readiness and registration blockers. Put the full country catalogue behind search/filter. Link each missing prerequisite to its actual setup flow rather than relying on a general guide.

## Proposed page

Delivery mode comparison → account setup/test → enabled destinations and per-segment pricing → delivery health. Present unavailable vendors without an operable-looking production setup path.

## Dialogs and interactions

SmsAccountDialog: vendor-specific labels, stored-secret replacement behavior, “Verify account” before “Use this account,” and the affected project. Credentials must remain one-way. A failed check preserves non-secret form context and gives a safe recovery path.

## Acceptance checks

Compare managed versus own-account costs without concluding SMS is free. An unsupported vendor never appears operational. Change credentials with invalid input and receive a useful error without silently switching delivery.

## Settled while implementing

- **The two arrangements are two panels, not a segmented switch.** They are not two
  settings of one thing: the estimate, the billing owner and the readiness are three
  answers that differ between them, and a toggle offers no way to compare three answers.
  Each panel carries its own state and its own action, `Connect account` and `Manage` live
  inside the own-account one, and the panel in force wears a ring and an `In use` badge.
- **Nothing reads as carrying traffic, because nothing does.** Every vendor adapter is a
  port with no implementation, so `twilio` and `aws` are `planned` and `transportWired()`
  answers false. The managed panel says so under Availability, the meter reads nought
  rather than drawing eighteen thousand messages nobody sent, and the route column is
  renamed `Intended route` and hidden behind the columns menu: what the router *would*
  choose is not what it does, and only one of those is safe to draw as a table.
- **The unit is per segment everywhere.** The column is `Price per segment`, the panel's
  estimate says `per segment` under the figure, and the foot repeats what a segment is.
  `RATE_SOURCE` says once where the numbers come from, so a price reads as an example of
  what a country costs and never as a quote.
- **The table opens on the project's own destinations.** `Allowed first` is the default of
  three, with a search beside it, and `routeReadiness` gives every row a verdict and the
  one thing standing in its way: the allowlist first, because it is the project's own and
  free to change, then the registration. The deployment-wide gap is stated once above the
  table rather than repeated on two hundred rows. Every Action goes to the setup flow that
  settles it and never to a general guide.
- **Delivery health leads the page.** The mockup puts it last, under the table; read that
  way, the one thing an operator glances at on arrival was three screens down. It is a
  figures strip, so it goes where every figures strip on this panel goes, and the tiles are
  the honest kind: a faint wave and `No data` in words rather than a chart of nothing.
- **Connecting an account is two acts.** `Verify account` presents the credentials to the
  vendor and reports what it said; only then does the footer become `Use this account`.
  Editing either half makes the answer stale and the footer goes back. A refusal keeps the
  vendor and the key, clears the secret because it is the half that is usually wrong and
  the half nobody can read back, and switches nothing.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [SmsAccountDialog.vue](../apps/client/app/components/SmsAccountDialog.vue)
- [sms-providers.ts](../apps/client/app/stores/sms-providers.ts)
- [sms-policy.ts](../apps/client/app/stores/sms-policy.ts)
- [sessions.ts](../apps/client/app/utils/sessions.ts)
- [sms-policy.ts](../apps/client/app/utils/sms-policy.ts)
- [sms-providers.ts](../apps/client/app/utils/sms-providers.ts)
