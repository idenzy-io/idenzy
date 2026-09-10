# Sessions & devices

Route: `/sessions` · [Page source](../apps/client/app/pages/sessions/index.vue)

## User task

I need to investigate an unfamiliar sign-in and end the appropriate session without disrupting every device.

## Keep

Keep the distinction between active, expired and revoked sessions, device context, and the existing “only this user” filtering behavior.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Sessions & devices                              [Export CSV]
[Active] [Expired] [Revoked] [All history]
[Search user/device/IP........................] [Filters] [Columns]
[Device + platform | User | State | Last active | Actions]
[... rows ...]
[Selected: N sessions] [Revoke selected] [Clear]
[Count / pagination]

Selected session:
[Device, user, state]                              [Revoke session]
[Activity timeline] [IP / approximate location / network]
[Authentication factors] [Related security signals] [Audit link]
```

Place Export as a secondary header action. Keep Active as the initial operational view. Put Revoke session in selected-session detail, next to the precise device identity; row actions remain shortcuts into the same confirmation. The user identity links to user detail, while a separate “Only this user” chip narrows the list.

### Mobile arrangement

Show device, user, state and last-active time in one compact row. Open a full-height session sheet for IP/factor evidence. Keep the revoke footer reachable without horizontal scrolling.

### Buttons, dialogs and states

Confirmation order: device/user/project → existing state → access-ending timing → selected count. Cancel left, Revoke session(s) right. For already-ended sessions, replace the destructive button with the recorded reason and time.

## Findings and fixes

### P1 — The title and counts blur devices and sessions

The header says every signed-in device while the default All view includes expired and revoked rows and the device total differs from session total. Default to Active for immediate support, or name the history explicitly and define unique devices.

### P1 — A dense row makes risk interpretation difficult

IP, country, network, second factor and timestamps compete in eleven columns. Lead with person, device, state and last activity; open a detail panel for evidence. Keep location as approximate context rather than a certainty about a person's physical location.

### P1 — Revocation needs its propagation caveat

A confirmation should state that Idenzy API access ends immediately and customer offline verification depends on token lifetime/revocation integration. Do not promise instant sign-out from every customer backend.

### P2 — Investigation context does not travel far enough

The local user filter is useful, but there is no complete cross-page user detail journey. Link to related security signals and audit entries with subject/project context and a clear way back.

## Proposed page

Active sessions list → device/person detail → evidence → revoke decision. History is a nearby tab rather than the same default working queue.

## Dialogs and interactions

SessionRevokeDialog should say “Revoke this session” or “Revoke N selected sessions,” list affected people/devices, state whether the current dashboard session is included, and remain open on failure. Expired/revoked rows should explain why revocation is unavailable.

## Acceptance checks

Investigate the same user on two devices, revoke one and verify the other remains. On mobile, identify the state before opening Actions. Verify expired history cannot be mistaken for live access.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md). Findings describe the current prototype; proposed behavior requires implementation and usability validation.

## Implementation references

- [SessionRevokeDialog.vue](../apps/client/app/components/SessionRevokeDialog.vue)
- [sessions.ts](../apps/client/app/stores/sessions.ts)
- [sessions.ts](../apps/client/app/utils/sessions.ts)
