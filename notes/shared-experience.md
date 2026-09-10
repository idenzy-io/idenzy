# Shared dashboard experience

## Main diagnosis

The repeated style is not inherently a problem. Familiar controls, typography and navigation reduce learning effort. The problem is repeated information hierarchy: many pages use a large stack of framed sections, small explanatory paragraphs, a right-hand four-metric block and guides. Configuring one setting can feel like reading a technical article.

Some explanatory sections already collapse. Preserve that useful mechanism, but collapsed editable sections need summaries of their current values. “Requirements” alone forces opening the section to discover the minimum length; a summary such as “8 characters · breach check on” makes it useful while closed.

## P1 — Give each task the right structure

| Task | Suitable page structure | Examples |
| --- | --- | --- |
| Decide what needs attention | Prioritized work list and a few supporting trends | Overview, Security |
| Find a person and act | Searchable list → contextual detail | Users, Sessions, Recovery |
| Configure policy | Compact form + current outcome + advanced explanation | Passwords, MFA, Lifetimes |
| Connect an external system | Prerequisites → setup → test → activate | Domains, Providers, Webhooks |
| Author content | Persistent editing workspace and preview | Email templates, Claims |
| Follow a long operation | Guided setup → review → job progress/history | Import, Data requests |
| Understand money | Period, scope, line items and payment state | Usage, Billing |

Reuse the component library within these structures. Do not assign every page a new accent colour or decorative illustration to make it “different.”

## P1 — Make scope unambiguous

The sidebar calls its fixture a project, General describes organisation-owned members and billing, while several stores key these resources by project. Overview says “across every project.” Settle the actual ownership model first and show the affected project/organisation in each mutation.

Keep the project identity visible on narrow screens. At 390px, the rendered header squeezes the breadcrumb to a fragment while balance and Top up stay prominent. Place funding in a compact menu or Billing and reserve header space for the current project. Do not create a fake test/live toggle: separate projects are the current environment boundary.

## P1 — Distinguish configured, verified, operating and unavailable

An enabled method may still have missing origins, invalid credentials or no delivery provider. Prefer “Setup incomplete — add an allowed origin” to a bare “On.” An unavailable capability needs an honest explanation and a next action, not a success-looking control.

Use loading, empty, filtered-empty, error, stale and permission-denied states separately. A zero is measured absence; missing telemetry is unknown. Remove nonfunctional support and export affordances, or explain their unavailability at the point of use.

## P1 — Make support tasks connect

User → sessions → relevant security signals → audit trail should preserve the same subject and project. Return to the original list with its filters intact. Currently user/session tables expose useful actions but lack a full subject workspace. Add shareable filtered routes where appropriate, without putting credentials or unnecessary personal data into URLs.

## P2 — Reduce visual and verbal load

Use one main container boundary per task instead of multiple equally weighted frames. Keep explanatory body text comfortably readable; widespread 10–12px muted text is a concern, especially in long dialogs. Measure contrast in both themes before asserting conformance.

Use direct labels: “Blocked email addresses,” “Additional verification,” “Request source,” “Save password policy.” Replace repeated sections titled “What this never does” with short contextual explanations only where a misunderstanding is likely.

A better settings hierarchy: title and current state → editable controls → effect on users → optional technical details. Routine reference material should not compete with a production-impact warning.

## P1 — Mobile tables need decision context

The page-width check passes on all dashboard routes at 390px, but that does not prove usability. The Users screenshot shows identity and action controls while status sits outside the initial table viewport. Keep identity, state and the primary task visible together, through a compact row summary or detail sheet. Preserve horizontal access to secondary columns and announce scrolling; do not call cropped context “responsive.”

## Validation

Run first-time setup, blocked-user investigation, provider credential rotation and billing review with unfamiliar developers and support staff. Ask them to explain the effect of an action before pressing it. Measure wrong turns, misinterpreted states and completion, not just speed. These are proposed studies, not studies already performed.

Design rationale: concise status, familiar terminology, visible context and error prevention apply the [NN/g usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/). Keyboard access, reflow, contrast, labels and status announcements should be assessed against [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/). These sources are a baseline, not proof that this dashboard passes.

