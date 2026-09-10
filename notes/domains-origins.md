# Allowed origins

Route: `/domains/origins` · [Page source](../apps/client/app/pages/domains/origins.vue)

## User task

I need my browser application to call the auth API without a CORS failure.

## Keep

Keep explicit confirmation of suggested origins; deriving suggestions without silently widening permissions is the right pattern.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Allowed application origins                         [+ Allow origin]
[Configured origin | Added from | Last observed use* | Remove]
[Suggested additions: source -> exact origin]              [Allow]
[Test an application URL................................] [Check]
[Parsed origin] [Allowed / Not allowed / Unknown]
[If blocked: Add this origin]
[Recently refused origins*]                 [CORS explanation v]
```

Place Allow origin in the page header and put configured entries first. Suggested additions sit in a separate compact section with explicit per-origin acceptance. The diagnostic field is a full application URL; the result shows its extracted origin before offering a permission change. Telemetry marked * is proposed until its data source exists.

### Mobile arrangement

Each configured/suggested origin becomes a row with full origin text and one labelled action. Put the check button below the diagnostic field. Avoid tiny icon-only removal buttons next to copy controls.

### Buttons, dialogs and states

Add dialog: scheme/host/port, normalized preview and exact-match explanation; Cancel / Allow origin. Remove dialog: application origin, affected project and next-request consequence; Keep origin / Stop allowing origin. Error copy must distinguish invalid syntax from a denied save.

## Findings and fixes

### P1 — The empty-state statement is broader than the actual condition

“No browser can complete a sign-in” ignores the documented development loopback exception and confuses CORS with all authentication paths. Explain the affected browser origins and environment rather than making an absolute claim.

### P1 — The current page explains CORS but does not diagnose my app

Add an origin checker: enter the exact application URL, show its normalized origin and whether it is permitted for this project, then offer Add when authorized. Include the configured API host and a safe browser-request test.

### P2 — Suggestions need context and deduplication

Suggested origins are useful, but repeated URL text and technical source names add noise. Show each origin once with “From passkey settings” or “From return URL,” and explain what permission accepting it grants.

### P2 — Implementation detail buries the repair path

The response-versus-preflight discussion is useful developer reference. Lead with origin syntax, scheme/host/port distinctions and the observed refusal; put SQL lookup and timing rationale in an expandable explanation.

## Proposed page

Configured origins and Add → suggested additions → Test an application origin → recently refused origins, when real telemetry exists → optional CORS reference.

## Dialogs and interactions

OriginAddDialog: “Application origin,” example https://app.example.com, clear treatment of paths and ports. OriginRemoveDialog: name the origin, affected application and next-request effect; retain a specific warning when removing the only production origin.

## Acceptance checks

Paste a URL containing a path and understand the required origin form. Confirm a suggestion does not auto-add other grants. Verify an empty result is not presented as proof that nobody attempted a blocked call when telemetry is unavailable.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [OriginAddDialog.vue](../apps/client/app/components/OriginAddDialog.vue)
- [OriginRemoveDialog.vue](../apps/client/app/components/OriginRemoveDialog.vue)
- [origins.ts](../apps/client/app/stores/origins.ts)
- [otp.ts](../apps/client/app/stores/otp.ts)
- [passkeys.ts](../apps/client/app/stores/passkeys.ts)
- [origins.ts](../apps/client/app/utils/origins.ts)
