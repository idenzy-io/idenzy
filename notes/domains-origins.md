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

## Settled while implementing

- **Observed use leads, and every tile reads no data.** Nothing records the `Origin` on a
  request, so the four figures draw the stand-in wave and say so in words. The line under
  them is the one this screen cannot do without: read an empty answer as nobody counting
  rather than as nobody being blocked, because a refusal is invisible from here by
  construction. `unknownFor` returns nothing while `ORIGIN_TELEMETRY` is false, fixtures and
  all, for the same reason.
- **`Last observed use` is a column that says "Not recorded".** It is the first question
  asked of a list like this, and an absent column reads as an answer nobody thought to give.
- **The checker is what makes this a diagnosis screen.** A whole application URL goes in,
  the answer shows it reducing to an origin before it offers anything, and only then names
  the verdict. `checkOrigin` has four: allowed, blocked and addable, refusable by a rule this
  list holds (http, loopback, a wildcard), and a URL with no origin at all such as
  `myapp://callback`. Watching the path and the query fall away is most of what it teaches.
- **The empty state names who is affected rather than claiming nobody can sign in.** A server
  calling the API sends no `Origin` and is unaffected; a page on localhost is allowed by the
  deployment while it runs in development. What is broken is the browser origins a customer
  deploys to, and the state says that and no more.
- **A suggestion is one row, one source, one sentence about what it grants.**
  `ORIGIN_SOURCE_FROM` phrases the source as the screen it came from — "From passkey
  settings", "From a provider return URL" — and the URL it was read off is not repeated,
  because the same origin arrives from several of them and a list that said so three times
  read as three decisions.
- **The response-versus-preflight reference is folded.** Origin syntax, the exact match and
  the development loopback lead; the lookup, the timing and where CORS is enforced sit in
  the expandable with the two sample responses, which is the one thing prose cannot carry.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [OriginRow.vue](../apps/client/app/components/OriginRow.vue)
- [OriginAddDialog.vue](../apps/client/app/components/OriginAddDialog.vue)
- [OriginRemoveDialog.vue](../apps/client/app/components/OriginRemoveDialog.vue)
- [origins.ts](../apps/client/app/stores/origins.ts)
- [otp.ts](../apps/client/app/stores/otp.ts)
- [passkeys.ts](../apps/client/app/stores/passkeys.ts)
- [origins.ts](../apps/client/app/utils/origins.ts)
