# Passkeys

Route: `/methods/passkeys` · [Page source](../apps/client/app/pages/methods/passkeys.vue)

## User task

I need to enable passkeys for my application domain without invalidating credentials already enrolled.

## Keep

Keep the combined RP-ID/origin change and the existing count of affected credentials in PasskeyRpIdDialog.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Passkeys                                [Ready / Setup incomplete]
[Setup blockers................................] [Complete setup]
[Passkey domain (RP ID): example.com]                   [Change domain]
[Product name: Example]                                [Edit]
[Allowed application URLs]                             [+ Add URL]
  https://app.example.com                             [Remove]
[Setup check: domain / origins / CORS / integration]    [Test setup*]
[Enrollment summary]                     [Advanced WebAuthn details v]
```

Put the readiness panel above the On/Off control. Initial setup uses a form with RP ID, product name and first application origin in that order, followed by Save configuration at bottom right. Existing setup shows readable values and separate actions: routine Edit name is quiet; Change domain signals a consequential migration. A test action is proposed and must describe whether it actually checks browser integration.

### Mobile arrangement

Use one column; long URLs wrap or scroll within a copy field while the full value remains accessible. Put the setup checklist before enrollment statistics. Keep Change domain out of a cluster of identical tiny Change buttons.

### Buttons, dialogs and states

Domain-change dialog order: existing RP ID → new RP ID → compatible origins retained/removed → replacement origin if required → affected accounts → acknowledgement. Cancel left, Save new domain right. Origin dialog takes an application URL, with example and RP-ID validation, or an Android app's SHA-256 signing certificate fingerprint, shown as the `android:apk-key-hash:` origin it is stored as; an iOS app needs no entry. Add at bottom right.

## Findings and fixes

### P1 — Enabled is not operational

Acme shows passkey sign-in On while the relying party is not configured and ceremonies cannot work. Replace the headline with “Setup incomplete” and a primary setup action until RP ID and origin checks pass.

### P1 — The RP-ID decision needs a domain example

“Relying party” and “ceremony” are standards terms, not sufficient instructions. Use “Passkey domain (RP ID),” “Product name shown by the device,” and “Application URLs.” Show example.com versus https://app.example.com and distinguish CORS origins.

### P1 — Changing the domain can strand users

The existing change dialog lists dropped origins and affected credentials, which is valuable. The count is the API's (`passkeys` on the relying-party answer), and the acknowledgement sends it back as `strandPasskeys`: the server moves the domain only when it matches what the project holds, and keeps the stranded credentials so moving back revives them. Add the number of accounts without another sign-in method and a migration/re-enrolment plan before activation. Describe invalidated credentials as an operational consequence, not merely a protocol fact.

### P2 — The right-hand authenticator statistics do not help setup

Device-provider counts are useful later. In incomplete setup, replace them with a configuration checklist and a test result; keep algorithm and challenge details behind advanced reference.

## Proposed page

Setup state → domain/application configuration → browser compatibility/test instructions → enrolled-credential summary. Separate initial setup, routine display-name edits and risky domain migration.

## Dialogs and interactions

PasskeyRpIdDialog: “Change passkey domain” with old → new, origins kept/removed, affected accounts and “Save new domain.” PasskeyRpNameDialog is a simple inline edit candidate. PasskeyOriginDialog should validate against RP ID and link to the separate Allowed origins step.

## Acceptance checks

Start with Acme's incomplete fixture and finish configuration without mistaking On for ready. Enter a full URL as RP ID and get the correction. Attempt a domain change with no compatible origin and understand the blocker.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md). Findings describe the current prototype; proposed behavior requires implementation and usability validation.

## Implementation references

- [PasskeyRpNameDialog.vue](../apps/client/app/components/PasskeyRpNameDialog.vue)
- [PasskeyOriginDialog.vue](../apps/client/app/components/PasskeyOriginDialog.vue)
- [PasskeyRpIdDialog.vue](../apps/client/app/components/PasskeyRpIdDialog.vue)
- [passkeys.ts](../apps/client/app/stores/passkeys.ts)
- [passkeys.ts](../apps/client/app/utils/passkeys.ts)
