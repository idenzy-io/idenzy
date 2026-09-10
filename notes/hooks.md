# Hooks

Route: `/hooks` · [Page source](../apps/client/app/pages/hooks.vue)

## User task

I need to change an authentication decision from my own service without accidentally breaking sign-in.

## Keep

Keep the hook/webhook comparison, pipeline placement, deadline visibility and explicit fail-closed consequences.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Hooks                                      [Active hooks N] [Integration guide]
[Need notification only? Open Webhooks]
[Before sign-up | Ready? | Deadline | Failure rate | Configure]
[Before sign-in | Ready? | Deadline | Failure rate | Configure]
[Customize claims | ...]
[Send email | ...] [Send SMS | ...]
[Selected hook: where it runs in the request]
[Endpoint] [Deadline] [Request / expected response]
[Validate configuration*]                   [Review and enable]
[Advanced signing / failure reference v]
```

Keep the hook/webhook distinction as a short first-line decision. Give each hook a visible Configure/Manage action instead of only an ellipsis. The selected hook owns endpoint and deadline controls, contract example and test. Enable comes after configuration review, with its potential sign-in failure stated right beside it.

### Mobile arrangement

Use vertically stacked hook rows with purpose and status, then a full-height configuration view. Put deadline units beside the value. Keep the failure consequence above the activation footer.

### Buttons, dialogs and states

Endpoint dialog: hook name and project → URL → expected response → timeout/failure consequence → Cancel / Save endpoint. Deadline edit uses a bounded duration field and observed latency context. Removing a gate needs Keep gate / Remove gate with the skipped enforcement named.

## Findings and fixes

### P1 — Configured fixtures look like live enforcement

The page shows live hooks and traffic, but these stores simulate configuration and the real management/delivery integration is incomplete. Represent availability and validation before live state. A customer must not rely on a gate that only exists in local state.

### P1 — Endpoint setup does not establish readiness

Saving a URL can move a synchronous dependency into the sign-in path. Use configure → test contract/reachability → review latency and failure behavior → activate. Test cannot guarantee future availability, so retain clear failure monitoring.

### P1 — The signing-secret reference is ambiguous

The page says hooks share “your webhook secret,” while Webhooks has per-endpoint secrets. A project can have zero or several webhooks. Define which credential signs a hook, how it is obtained and what rotation affects before asking users to implement verification.

### P2 — The long explanation delays the key decision

The comparison is valuable, but five hook descriptions, flow mechanics, failure sections and repeated negatives create a reading task. Lead with the selected hook's purpose and user-visible delay; reveal its contract while configuring it.

## Proposed page

Short “Need to change a decision?” choice → hook points and readiness → selected hook configuration/test → live latency/failure evidence → advanced lifecycle reference.

## Dialogs and interactions

HookEndpointDialog should show the specific hook, project, URL, request/response example and concise failure impact. NumberDialog's deadline needs a range, units and current latency context. Removing a gate needs confirmation of the policy it stops enforcing.

## Acceptance checks

Configure a deliberately unreachable endpoint and see a failed test without enabling it. Explain what happens at its deadline. Disable a before-sign-in gate and explicitly acknowledge that its decision will no longer be checked.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [HookEndpointDialog.vue](../apps/client/app/components/HookEndpointDialog.vue)
- [NumberDialog.vue](../apps/client/app/components/NumberDialog.vue)
- [hooks.ts](../apps/client/app/stores/hooks.ts)
- [hooks.ts](../apps/client/app/utils/hooks.ts)
