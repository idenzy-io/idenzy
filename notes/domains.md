# Auth domains

Route: `/domains` · [Page source](../apps/client/app/pages/domains/index.vue)

## User task

I need my application to use a custom authentication API host and understand what DNS and SDK configuration must change.

## Keep

Keep the distinction between an API domain and a hosted sign-in page, the shared-host fallback and separate links to origins and sending domains.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Auth domains                                           [+ Add domain]
[Current API host........................................] [Copy]
[Header mode available] [Cookie mode: setup required / ready]
[Domain | DNS | Certificate | Last checked | Manage]
[Setup: Host -> DNS -> Certificate -> Update SDK -> Test]
[Required DNS records: Host / Type / Value / Copy]
[Last result + next action]                        [Check DNS]
[Your app origin] [Configured SDK URL]               [Verify setup*]
```

Keep Add domain at the top right. Current API host is a prominent copy field directly below the title. Setup owns the main column; supplemental explanations occupy a small optional help area. Check DNS sits under the records, while Update SDK becomes the primary next step only after verification. Explain what a proposed Verify setup check actually covers.

### Mobile arrangement

Use stacked DNS cards and a compact vertical stepper. Keep current host and project visible above setup. Provide copy controls independent of truncated previews and preserve full-value inspection.

### Buttons, dialogs and states

Add-domain dialog: hostname, example auth.example.com, DNS-access prerequisite and short what-happens-next. Footer Cancel / Add domain. Remove dialog: exact host, known dependencies and explicit migration requirement. Cancellation does not change the current host.

## Findings and fixes

### P1 — The starting explanation is too architectural

The empty state discusses CNAMEs, load balancers, JSON twins and SameSite together. Start with the user's choice: “Use auth.example.com for authentication requests.” Explain cookie-mode benefits and DNS access, then guide setup.

### P1 — Verification and client migration are different steps

A verified host does not automatically update a deployed SDK base URL or make unrelated app domains same-site. Add a final Configure your app step showing the exact URL and testing the intended app origin.

### P1 — Endpoint examples disagree across pages

Auth domains, General, Revocation and OAuth examples use different shared hosts. All copyable configuration must derive from the same project/cell/domain settings. Keep illustrative values visibly marked.

### P2 — Disabled capability looks like an error incident

“Cookie mode: Refused” and “Same-site with: Nothing” are unfriendly default states when shared-host/header integration is legitimate. Use “Requires a custom domain on your app's site” with a setup action, and reserve errors for a failed attempted setup.

## Proposed page

Current API host → add domain → publish DNS → verification/certificate status → update SDK and test → connected applications. Advanced HTTP behavior belongs below this workflow.

## Dialogs and interactions

AuthDomainAddDialog should contain one hostname field, a concrete subdomain example and the next steps. AuthDomainRemoveDialog should list the exact host and identify clients still using it; the shared-host fallback is not an automatic client migration.

## Acceptance checks

Configure a host with partial DNS and understand which check failed. After verification, identify exactly what changes in the SDK. Removing a domain does not promise that existing cookie-based clients seamlessly switch to header mode.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [AuthDomainAddDialog.vue](../apps/client/app/components/AuthDomainAddDialog.vue)
- [AuthDomainRemoveDialog.vue](../apps/client/app/components/AuthDomainRemoveDialog.vue)
- [auth-domains.ts](../apps/client/app/stores/auth-domains.ts)
- [auth-domains.ts](../apps/client/app/utils/auth-domains.ts)
