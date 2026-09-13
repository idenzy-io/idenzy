# Revocation

Route: `/tokens/revocation` · [Page source](../apps/client/app/pages/tokens/revocation.vue)

## User task

I need to know whether a session I ended can still access my backend and how to reduce that delay.

## Keep

Keep the explicit distinction between Idenzy API enforcement and customer verifier propagation, plus the absence of a fictional project-wide revoke control.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Revocation integration                         [Refresh status]
[Not connected / Last read / Stale]             [Set up verification]
[Idenzy API: immediate] [Your backend: current exposure]
[1 Configure SDK] -> [2 Run test] -> [3 Confirm enforcement]
[Copy server example] [Test instructions]
[Recent revocations: person/session | When | Effect] [Open sessions]
[Advanced: signed snapshot / payload / TTL / polling diagnostics v]
```

Put connection status and the current exposure at the top. Set up verification is the primary action until configured; afterward replace it with View integration/test. Refresh status is secondary and says what it refreshes. Place Open sessions beside the human-readable history, because session revocation itself belongs there.

### Mobile arrangement

Stack the two enforcement summaries and setup steps. Keep raw JSON collapsed. Long IDs go in a copyable detail view; no critical action should require horizontal navigation through the snapshot.

### Buttons, dialogs and states

A proposed test flow names the synthetic session, expected verifier and observed response. Put Run test at the bottom right and Cancel/Back left. Never use a real customer's session implicitly. Missing telemetry should say Unknown, not Connected.

## Findings and fixes

### P1 — The most important state is secondary

Personal Team says Nothing polls this, yet the process diagram includes “Within 5 seconds.” Lead with “Your backend is not connected to revocation updates” and the current token-expiry exposure. Label the diagram's last step as conditional.

### P1 — A read of the snapshot is not end-to-end coverage

A last-read timestamp cannot prove every backend process verifies against a fresh cache. Show last observed read and integration scope; provide an end-to-end test involving a synthetic session and a customer verifier.

### P2 — Raw snapshot entries are a poor primary task

Session IDs, watermarks and expiry countdowns make this look like infrastructure inspection. Put integration health and a setup/test action first; keep raw entries as an advanced diagnostic table.

### P1 — Copyable URLs disagree with other pages

This page uses auth.idenzy.io while General and Auth domains show other endpoints. Derive issuer/project examples from current configuration, label placeholders and clearly keep secret-key setup server-side.

## Proposed page

Integration health → what revocation means now → SDK setup/test steps → propagation timeline → advanced snapshot viewer. Link to Sessions for the actual support action.

## Dialogs and interactions

The connection test uses an explicitly created test session and shows expected/observed timing. Do not add a fake toggle claiming it enables every external verifier.

### Settled while implementing

**The setup steps are a dialog, not a card on the page.** This note originally said no page-specific modal was needed. Built inline, the three steps were a card among five and the header's primary action had nowhere to go but a scroll to it, which is a dead click on a folded card and a jump the reader did not ask for. `RevocationSetupDialog` is the same shape `ProviderSetupDialog` already uses for the same kind of work: ordered steps, copy fields, one action, over a page that stops competing with it. The step rail is tabs once a test has run, so somebody re-testing after a deploy does not walk past a step they are not changing.

**Confirming enforcement leaves the dialog up.** It records a statement rather than saving a form, so dismissing on the click would hide the one thing the reader came to see land. The footer then offers Confirm again beside Done.

**The page opens on the history, under a figures strip.** The findings below are about what leads, and the strip is what answers them without a card having to: the exposure at the customer's verifier, our own API's answer, the last observed read and its state, what is in the set, what has been revoked, and the retention. Everything else on the page is a folded card, because each is read once by somebody who has just met a question it answers.

## Acceptance checks

Without a poller, the page never promises five-second enforcement. With a stale poller, distinguish stale from empty. Verify every generated SDK example uses the active project and configured endpoint.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [revocations.ts](../apps/client/app/stores/revocations.ts)
- [lifetimes.ts](../apps/client/app/stores/lifetimes.ts)
- [sessions.ts](../apps/client/app/stores/sessions.ts)
- [lifetimes.ts](../apps/client/app/utils/lifetimes.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
- [revocation.ts](../apps/client/app/utils/revocation.ts)
- [sessions.ts](../apps/client/app/utils/sessions.ts)
- [RevocationSetupDialog.vue](../apps/client/app/components/RevocationSetupDialog.vue)
- [RevocationPath.vue](../apps/client/app/components/RevocationPath.vue)
- [CodeBlock.vue](../apps/client/app/components/CodeBlock.vue)
