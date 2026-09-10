# Shared layout and interaction blueprint

This is a proposed design specification. Individual page mockups are task-specific compositions of these rules; measurements are starting values to validate in the existing Vuetify/Tailwind implementation.

## Dashboard shell

```text
DESKTOP
+------------------------+----------------------------------------------------+
| Project selector       | Project / section / page           Help  My account |
| Project + environment  +----------------------------------------------------+
|                        | Page title              Secondary action [Primary] |
| Overview               | One short purpose sentence                         |
| Users                  |                                                    |
| Authentication         |            Task-specific workspace                 |
| Delivery               |                                                    |
| Monitoring             |                                                    |
| Integrations           |                                                    |
| Project settings       |                                                    |
|                        |                                                    |
| My account             |                                                    |
+------------------------+----------------------------------------------------+

MOBILE
+-------------------------------------------+
| Menu   Project / environment   Account     |
+-------------------------------------------+
| Page title                                |
| Brief purpose                             |
| [Primary action]           [More actions]  |
| Task state / urgent prerequisite          |
| Task content                              |
| ...                                       |
+-------------------------------------------+
| Contextual editor actions, when needed    |
+-------------------------------------------+
```

- Keep the existing approximately 260px desktop navigation and 56px top bar as a starting point. Do not rebuild familiar navigation merely for visual novelty.
- Project identity gets priority over account balance. Put funding in Billing and show an urgent funding notice only where relevant. My account is global; membership/billing scope must follow the settled backend model.
- Use the same responsive breakpoint for shell logic and its CSS. At the current desktop threshold, the overlay drawer must close after navigation and return focus predictably.
- Desktop page inset: 24px; mobile: 16px. Use a 12-column content grid with roughly 24px gaps, constrained by the existing 1280px content maximum. Below the desktop breakpoint, stack columns rather than shrinking them indefinitely.
- Page title: approximately 24–28px, section title 16–18px, ordinary body/control text 14–16px, supporting text 12–14px. Avoid long 10–11px paragraphs. Final values need contrast/zoom validation, not just visual approval.
- Maintain a consistent spacing rhythm: 8px within a control group, 16px between related fields, 24–32px between sections. A border should identify a meaningful region; nested frames are not required around every sentence.

## Page families

| Family | Dominant content | Secondary content | Avoid |
| --- | --- | --- | --- |
| Operational list | Search, filters, records, selected-record detail | Relevant totals and history | A metrics sidebar unrelated to the investigation |
| Configuration | Effective state, editable controls, consequence preview | Optional technical rationale | A sequence of identical Change dialogs for tiny edits |
| Integration setup | Prerequisites, ordered steps, copy fields, test result | References and provider-specific details | “On” without working configuration |
| Editor | Draft, validation, preview, publish status | Variable/reference help | Losing edits on close or changing language |
| Job workflow | Review, explicit execution, progress, results | History and downloadable errors | Equating a local timer with completed work |
| Financial view | Entity, period, amount, unit and payment state | Forecast with assumptions | A free-looking line hiding direct vendor charges |

## Button placement and hierarchy

1. One primary action per active task. Page-level creation belongs at the title's upper right on desktop and below the title on mobile.
2. Section-level changes live inside that section. Put Save at its bottom right and Cancel changes immediately to its left. A page with independent inline saves should not also offer a misleading Save everything.
3. Table filters sit above the table, search first. Keep Columns and Export secondary. User identity opens detail; the ellipsis is for less frequent actions.
4. Show bulk actions only after selection, including the count and whether selection spans pages. Do not silently include filtered-out rows.
5. Keep destructive actions away from normal primary actions. Use descriptive wording: Revoke session, Invalidate recovery codes, Delete project permanently. Red is for destructive consequence, not merely low confidence.
6. Sticky footers are for editors and long forms, not every page. Reserve space beneath content so the footer does not obscure the final field or error.
7. Copy buttons sit beside the exact value being copied, report success/failure, and never copy a shortened display value. Long values remain available for inspection.
8. Do not make disabled buttons a puzzle: give the unmet requirement near the control. A filled form should explain validation failures rather than silently refusing to enable submission.

## Field layout

Use visible labels above inputs. Units belong in the field suffix or immediately beside it. Place a short example/helper below the input; replace or supplement it with a specific error on failure and associate both programmatically.

Do not validate an untouched blank field as an error before the user has tried to complete it. On submit, focus the first invalid field and present a compact summary for long forms. Preserve successful field entries when another field fails. Handle permission and network errors differently from input errors.

Use segmented controls for a few mutually exclusive choices, searchable selectors for long lists, checkboxes for multiple selections, and switches only for immediate state changes with understandable consequences. A choice styled as cards still needs selection semantics and keyboard operation.

## Dialog blueprint

```text
+--------------------------------------------------+
| Action + specific resource                   [X]  |
| Project / account context                        |
| Short purpose or consequence                     |
|                                                  |
| Label                                            |
| [Input........................................]  |
| Example, requirement or actionable error          |
|                                                  |
| Before -> After / affected resources              |
| [ ] Specific acknowledgement, only if warranted   |
|                                                  |
| [Cancel]                      [Named final action] |
+--------------------------------------------------+
```

- Routine forms: about 440–520px wide. A short consequential review can use 560–640px. Long content editors become pages/full-height workspaces.
- Use an explicitly connected accessible title, initial focus, contained keyboard navigation and reliable return focus. An outside-click/Escape exit must not silently discard work.
- Small mobile dialogs retain page margins; long forms use a full-height sheet with a scrollable body and fixed title/action regions. Test with the software keyboard and at 200% zoom.
- Cancel is left, the named final action right. An explicit close button follows the same dirty-work protection. For a secret shown once, closing deliberately must be possible without falsely claiming it was stored.
- During save, prevent duplicate submission and show progress on the action. Only a successful operation closes the dialog. Failed saves keep input and show a recoverable error.

## State contract

| State | What appears | Next action |
| --- | --- | --- |
| Loading | Stable content outline, textual loading status | Wait; cancel if appropriate |
| Never configured | Required prerequisites and a short setup path | Start setup |
| Configured but unverified | Saved settings with missing checks | Verify / complete setup |
| Operational | Evidence-backed effective state and checked time | Manage / inspect |
| Empty data | Honest explanation of what creates the first item | Relevant create/setup action |
| No filter matches | Active filters and unchanged global data | Clear filters |
| Unavailable | Capability status and what is possible now | Alternative or documentation |
| Stale/error | Last known state, time and specific failure | Retry / repair |
| No permission | What is restricted and required role | Contact an authorized member |
| Unsaved/pending | Draft or saving state beside the edited task | Save / keep editing |
| Completed | Explicit result, affected resource and time | View result / continue |

## Accessibility checks

Meet [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/) for keyboard operation, visible focus, text/non-text contrast, accessible labels, status announcements and reflow. Test at 320px and 390px, both themes, 200% zoom, long names/URLs and larger text. A desktop table may legitimately scroll horizontally, but essential decision context must remain discoverable. Practical touch targets should be around 40–44px where possible; the WCAG minimum target criterion and its exceptions still require actual measurement.

Follow the [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) for modal naming, focus behavior and dismissal. These specifications are validation targets, not a claim of completed accessibility conformance.
