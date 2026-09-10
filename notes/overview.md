# Overview

Route: `/` · [Page source](../apps/client/app/pages/index.vue)

## Implementation update — September 9, 2026

The Overview redesign is implemented. The findings below retain the original audit context.

- The default view is a project-specific setup workspace, with the next action derived from available publishable keys and saved browser origins. Method choices link directly to their configuration pages; no checkbox pretends to verify a working sign-in.
- Connection details are expanded on desktop and optional on mobile. Users, sessions and usage have direct task shortcuts.
- Analytics are explicitly opt-in sample data until live telemetry exists. One period drives totals, traffic and the method breakdown; active sessions are labeled as a snapshot. Chart/table switching is keyboard accessible. The nonfunctional Export action is removed.
- Chrome validation covers 320, 390, 768, 1024 and 1440px, light/dark themes, project switching, period/table controls, method selection, the mobile disclosure and local setup-state changes. No horizontal page overflow or browser errors appeared in the final 36 captures. Six focused data tests pass, as do the client typecheck and scoped Biome checks; typecheck retains unrelated duplicate-auto-import warnings.
- A reduced-motion cold start revealed a lingering navigation-drawer scrim in the shared shell. That shell is outside this implementation's scope and remains unchanged. This is not a full accessibility-conformance claim.

Live health, successful-sign-in verification, production analytics and connected error/retry states still require the management/telemetry integration. The preview does not claim these are operational.

## User task

As a developer returning to the console, I need to know whether sign-in works and what needs my attention. As a new customer, I need the next step to my first successful sign-in.

## Keep

Keep the concise top-level metrics, consistent chart controls and table alternatives.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
[Project / environment context]                     [Period v] [Export]
Overview
[Attention: 2 setup blockers]                            [Continue setup]
[Sign-ins] [Failure rate] [Active sessions] [MAU this month]
[                 Sign-in traffic chart                           ]
[Authentication methods, 7 cols] [Recent important activity, 5 cols]
[Quick links: Users | Sessions | Integration setup]
```

Place period and secondary Export at the upper right. The attention strip owns the primary action only when work is required. Metric cards link to the relevant filtered investigation. On a new project, replace traffic with a numbered setup checklist and put “Continue setup” on the next incomplete row; completed rows show a check and an Edit link. Do not show realistic zero-state demo traffic.

### Mobile arrangement

At mobile width, title then period, attention strip, a 2×2 metric grid, traffic, methods and activity. Keep one visible next action; move Export into the page menu.

### Buttons, dialogs and states

No new dialog. The setup journey should lead to real configuration pages and return to Overview with the relevant check verified. Show a load error with Retry in the failed section, not a full page of zero metrics.

## Findings and fixes

### P1 — The scope contradicts the shell

The page says “across every project” while the shell names one project. The MAU tooltip also describes cross-project deduplication, whereas Usage describes a per-project allowance. Choose project or organisation scope explicitly and use the same definition across Overview, Usage and Billing.

### P1 — The first visit offers traffic instead of setup

The page generates plausible traffic even when configuration is incomplete. Add an empty-project journey: choose SDK → configure origin/method → integrate → verify first sign-in. Completion must come from actual checks, not checkbox clicks.

### P2 — Time periods are mixed

The heading promises seven days; tiles include today and thirty-day MAU; only the main chart changes with 1d/7d/14d. Use a shared period where meaningful and clearly label fixed-period exceptions.

### P2 — Metrics lack a next action

Failures and active sessions do not form an investigation path. Link to filtered signals, sessions and audit activity. Export currently has no handler; implement it or explain that it is unavailable.

## Proposed page

Established project: health/attention strip → small KPI row → traffic chart → recent actionable events. New project: setup checklist takes the main area; empty analytics remain secondary.

## Dialogs and interactions

No page-specific dialog. Header Export should communicate format, period and project before downloading; global project creation belongs in the shell audit.

## Acceptance checks

Switch projects and confirm all data and labels change together. Change a chart period and identify which figures stay fixed. A newcomer can find their first integration step without opening the full navigation.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md). Findings describe the current prototype; proposed behavior requires implementation and usability validation.

## Implementation references

- [metric-chart.ts](../apps/client/app/utils/metric-chart.ts)
