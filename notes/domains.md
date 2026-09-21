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

Auth domains, General, Revocation and OAuth examples use different shared hosts. All copyable configuration must derive from the same project/domain settings. Keep illustrative values visibly marked.

### P2 — Disabled capability looks like an error incident

“Cookie mode: Refused” and “Same-site with: Nothing” are unfriendly default states when shared-host/header integration is legitimate. Use “Requires a custom domain on your app's site” with a setup action, and reserve errors for a failed attempted setup.

## Proposed page

Current API host → add domain → publish DNS → verification/certificate status → update SDK and test → connected applications. Advanced HTTP behavior belongs below this workflow.

## Dialogs and interactions

AuthDomainAddDialog should contain one hostname field, a concrete subdomain example and the next steps. AuthDomainRemoveDialog should list the exact host and identify clients still using it; the shared-host fallback is not an automatic client migration.

## Acceptance checks

Configure a host with partial DNS and understand which check failed. After verification, identify exactly what changes in the SDK. Removing a domain does not promise that existing cookie-based clients seamlessly switch to header mode.

## Settled while implementing

- **The host in force leads, and the two capabilities under it are states.** The copy field
  is the value somebody came for, and the strip beneath says what the transport can do with
  it: header mode `Available`, cookie mode `Ready` or `Requires a custom domain` with the
  control that starts it, and the site the cookie would work across. "Refused" and
  "Nothing" described a project working exactly as intended as though it were an incident.
- **Setup is a dialog off a row**, the way the sending-domain and revocation setups open,
  with the note's five steps. It opens on the step with work in it, and a verified host may
  always walk to the test: gating the last step on the SDK would make the check unreachable
  for exactly the domain it is for, because whether a client shipped is not ours to see.
- **`Update SDK` and `Test` exist because verification is not migration.** A verified host
  changes no deployed base URL and makes no unrelated origin same-site. So step four hands
  over the exact URL and says nothing has happened until it ships, and `authNextStep` never
  claims otherwise; a test asserts the wording.
- **`setupProbe` names what the check covers, line by line, and where it stops.** Three
  lines are ours to observe: the name resolves, the certificate is *authorised*, the project
  answers by Host. The fourth is the application origin the operator names, which we can
  say is on the CORS allowlist and never that their build is calling this host. It is a
  pure function so the honesty is tested rather than trusted.
- **The screen is wired to the management API, and two claims went with the fixture.** A
  resolved authorisation record is not an issued certificate: Certificate Manager issues off
  that record and nothing here watches it do so, so the row says `Authorised` and the probe
  line says the same. And nothing checks DNS on a schedule, so "the first look runs within a
  few minutes" is gone — a check happens because somebody pressed for one, which is also why
  `Verify setup` runs a real check before it reads the result rather than replaying the last
  one. A read that fails says so and offers the read again, because the empty state under it
  would otherwise tell somebody their project has no domains.
- **Everything copyable is `apiBaseUrl` over the project's own domains.** One derivation, so
  the endpoint written here is the endpoint written on every other screen, and the SDK
  snippet is marked `Illustrative` rather than reading as configured.
- **Connected applications is a figures strip with nothing in it, and says so.** Requests
  are not metered per host, so the tiles draw the stand-in wave and `No data` in words. The
  question is a real one and the honest answer is a shape with no series in it; what is
  registered rather than observed is the CORS allowlist, and the line under the strip links
  to it and to sending domains.
- **The empty state leads with the choice.** "Use `auth.example.com` for authentication
  requests", then what it buys and what it costs in DNS access, then that everything already
  works without one. The architecture (load balancers, JSON twins, SameSite) is folded into
  `What a domain changes` below.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [AuthDomainSetupDialog.vue](../apps/client/app/components/AuthDomainSetupDialog.vue)
- [AuthDomainAddDialog.vue](../apps/client/app/components/AuthDomainAddDialog.vue)
- [AuthDomainRemoveDialog.vue](../apps/client/app/components/AuthDomainRemoveDialog.vue)
- [auth-domains.ts](../apps/client/app/stores/auth-domains.ts)
- [auth-domains.ts](../apps/client/app/utils/auth-domains.ts)
