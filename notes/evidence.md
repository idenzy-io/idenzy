# Audit evidence and limitations

## Scope and method

The review first examined product/architecture markdowns, then the client route inventory, shared shell, page code, related components, stores and utilities. Backend composition and delivery-status documents were used to distinguish real behavior from proposed or simulated capabilities. See [architecture](architecture.md) for the documentation inventory and each page note for source links.

The local client at `http://localhost:3000` was then visited with Playwright. All 37 file-based page routes were rendered and captured at 1440 × 1000 and 390 × 844: 32 dashboard pages and five authentication pages. A second desktop pass visited all dashboard pages with the Acme fixture selected. Personal Team and Acme reveal different empty/configured states. This is automated route coverage plus selected visual/interaction inspection, not a claim that every state was manually tested.

## Browser observations

| Check | Observed result | Interpretation |
| --- | --- | --- |
| Route rendering | No `pageerror` events in the 37-route capture pass | Does not establish that all requests, actions or integrations work |
| Dashboard document width at 390px | All 32 measured 390px | Nested tables can still conceal important context; Users does |
| Second-factor document width at 390px | Measured 451px | Reproducible horizontal page overflow |
| Email template unsaved subject | Escape closes; reopening restores the saved subject | Reproducible silent draft loss |
| Sampled dialog semantics | `role="dialog"`, `aria-modal="true"`, but no `aria-label` or `aria-labelledby` | Connect the visible title to the dialog's accessible name |
| Initial focus in sampled dialogs | Focus moved into an input | Full focus trapping, return focus and screen-reader behavior remain to test |

### Email draft reproduction

1. Open `/email/templates` and edit an existing template.
2. Replace the subject with `Unsaved audit draft` without saving.
3. Press Escape, then reopen the same template.
4. The original subject returns without a discard decision.

This was reproduced twice. Source inspection also finds draft reloading on locale changes; that second path needs its own regression test.

### Representative interaction inspection

Opened the provider setup, passkey RP-domain change, hook endpoint, account password, member invitation, project deletion, SMS account, automatic top-up and password minimum dialogs. Also inspected the inline import wizard; it is not a modal. Additional captures covered account email, data-request intake, authentication-domain addition, sending-domain addition, email-template editing, API-key creation, recovery threshold, TOTP issuer, manual top-up, SMS countries, claim addition, user addition and webhook endpoint creation.

The focused dialog semantics pass included hook endpoint, account password, member invitation, project deletion, automatic top-up and password minimum. Each lacked both naming attributes. Other captured dialogs should be checked individually rather than assuming identical semantics everywhere. Early automation attempts included selector timeouts and an incorrect assumption that import was a dialog; these are harness errors, not counted as application failures.

No real credentials, payment charges, message deliveries, provider changes or destructive production actions were submitted. Viewing a destructive confirmation is not validation of its execution.

## Important source-backed findings

| Finding | Evidence location | Review |
| --- | --- | --- |
| Management API is not a completed dashboard control plane | [Application module](../apps/management-api/src/app.module.ts), client stores linked in page notes | [Architecture](architecture.md) |
| Account password form does not pass entered credentials into a real change operation | [Account page](../apps/client/app/pages/account.vue), [password dialog](../apps/client/app/components/AccountPasswordDialog.vue), [store](../apps/client/app/stores/account.ts) | [Account](account.md) |
| API-key rotation guidance infers old/replacement roles from last use | [Key utilities](../apps/client/app/utils/keys.ts) | [Keys](keys.md) |
| Email edit state can be overwritten or dismissed (fixed: the dialog is now a workspace with per-language drafts) | [Workspace](../apps/client/app/pages/email/templates/[type].vue), [store](../apps/client/app/stores/email-templates.ts) | [Templates](email-templates.md) |
| Requested security/infrastructure behavior exceeds documented delivery status | [Service inventory](../docs/services.md), [delivery status](../todo.md), affected pages/stores | [Security](security.md), [SMS providers](sms-providers.md), [Settings](settings.md) |
| Recovery-code destination is missing from the page inventory | [Second-factor page](../apps/client/app/pages/auth/two-factor.vue), [client pages](../apps/client/app/pages) | [Second factor](auth-two-factor.md) |

Source findings concern this working-tree snapshot. A placeholder is not automatically a production vulnerability, and a frontend status is not proof of backend enforcement. Re-check contracts and deployment evidence before shipping the recommended behavior.

## Research basis

- [NN/g usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) inform visible status, task-oriented terminology, consistency, error prevention and recovery.
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) informs accessible naming and modal keyboard behavior.
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/) is the baseline for subsequent reflow, contrast, focus, labels and status-message checks.
- [GDPR regulation text](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng), Article 12(3), supports the distinction between one month from receipt and a universal fixed 30-day timer in the data-request note. Have the responsible privacy/legal owner approve applicable rules and exceptions; this audit does not establish legal compliance.

## What remains unverified

- Production authentication, authorization, persistence, billing, delivery, provisioning and job execution.
- Every account/role/project combination, theme, network failure, slow request and concurrent edit.
- Full keyboard traversal, screen-reader output, contrast measurement, zoom/reflow and software-keyboard behavior.
- Real-user task studies, comprehension measurements or accessibility conformance.
- Exhaustive SDK, database, cryptographic or infrastructure correctness.

Temporary capture artifacts and scripts remain under `/private/tmp/idenzy-ux-audit/` and `/private/tmp/idenzy-ux-*.cjs` on this machine. They are not portable project dependencies and may be removed by the operating system. The important observations and reproduction steps are recorded here; no screenshots containing fixture identities are needed in the repository.
