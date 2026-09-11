# Social providers

Route: `/methods/providers` · [Page source](../apps/client/app/pages/methods/providers.vue)

## User task

I need to connect Google or another provider, verify the redirect flow and know whether existing users will be linked safely.

## Keep

Keep provider-specific credentials, a copyable callback, external console link, stored-secret replacement semantics and explicit instant-mode restrictions.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Social providers                                      [+ Add provider]
[Google | Ready | Your app | Last test]                       [Manage]
[Apple  | Setup incomplete | Missing ...]               [Finish setup]
[Discord | Development only]                            [Use your app]
[Account linking policy v]

Provider setup workspace:
[1 Provider] [2 Callback & credentials] [3 Return URL] [4 Test]
[Provider console link] [Copy Idenzy callback]
[Client ID] [Client secret replacement] [Advanced scopes v]
[Application return URL] [CORS readiness]
[Back]                                            [Save] [Test sign-in*]
```

Keep Add provider in the header; the catalogue appears only when adding, with search above compact logo/name cards. Each configured provider has a visible Manage action rather than hiding all setup in the ellipsis. In the setup workspace, distinguish “Register at provider” from “Return to your application.” Move optional scopes and provider-token storage below the standard credentials.

### Mobile arrangement

Use a full-height setup sheet or page. Stack numbered stages and retain a sticky footer. Keep the callback copy action beside its field; allow full URL inspection even if the visual preview truncates.

### Buttons, dialogs and states

Remove provider: identity/project → affected sole-method accounts → identities retained → Cancel / Remove provider. Credential save preserves an existing secret when replacement is blank. A real sign-in test may leave the app, so explain return behavior and preserve the draft before navigation.

## Findings and fixes

### P1 — There is no complete return-URL configuration journey

ProviderSetupDialog leads with Idenzy's callback and credentials, but the page discusses a separately registered application return URI without providing a corresponding editor there. Add a clearly distinct application-return setup step and link to CORS verification.

### P1 — Configuration and readiness are conflated

A provider can be off, configured, using instant credentials, missing data or actually working. Present those states separately and test the callback before calling it ready. Instant mode needs a prominent production blocker and a switch-to-own-app path.

### P2 — The catalogue reads like adapter documentation

Each provider card explains email assertions at length, and another section repeats them. Use a searchable catalogue with logo/name and a short availability label; show provider-specific linking caveats after selection.

### P2 — Account linking is difficult to predict

“Join accounts on a verified address” is meaningful but abstract. Show examples for verified match, unverified match and no email, preserving proof requirements. Explain that a relay address can be a different identity without calling it a failure.

## Settled while implementing

**The test is a real sign-in, and it is recorded as run rather than as passed.** "Test the
callback before calling it ready" cannot be a check we compute: whether the provider console
holds our redirect URI is settled at their consent screen, before we are called at all, and
where the sign-in ends is the customer's own return page rather than ours. So the last step
states that out loud beside the four checks it *can* run, and starts a real one. A project on
a custom auth domain gets a button that opens the consent screen in a new tab, because a
top-level navigation resolves a project by `Host` alone; a project on the shared API host
cannot be sent there at all and gets the SDK call to run from its own application instead.
`readinessOf` therefore keeps `untested` between complete and ready, at a neutral tone: a
statement rather than a fault.

**Return URLs are a card on the page as well as step three.** The list belongs to the project
and every provider shares it, so a per-provider wizard is the wrong and only home for it; the
blocker and the check both need somewhere to send a reader. The dialog's step and the page's
card write the same `redirect_uris` rows under the `oauth` kind, and both offer the origin as
a separate tick (ADR-0006). Those return URLs now also feed the Allowed origins screen's
suggestions, which took a third source: `suggestionsFrom` is keyed by source rather than
taking a run of positional lists.

**A provider that is on and incomplete is a page-level blocker, not a row's problem.** It
fails after the user has already agreed at the provider, which is the one failure nobody can
see from either end, so it is raised at the top of the screen and names the missing field.

**No right rail.** The mockup is a single column and this is an integration screen:
prerequisites, setup, test. The four figures moved into a `Statistic` strip under the setup
check, and the per-provider sign-in count moved onto each row, where the question it answers
is being asked.

## Proposed page

Configured providers with readiness and primary Manage action → searchable Add provider → guided callback, credentials, return destination and test → account-linking policy.

## Dialogs and interactions

ProviderSetupDialog: numbered setup steps, provider-specific field names, blank replacement secret means keep current, and an explicit test/activation result. ProviderRemoveDialog already identifies stranded users; retain that before removal and explain identities remain available if reconfigured.

## Acceptance checks

Configure a provider from a blank project without confusing the two redirect destinations. Reopen credentials and see that an empty secret preserves it. Test instant-mode migration and removal when users have no alternative method.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md). Findings describe the current prototype; proposed behavior requires implementation and usability validation.

## Implementation references

- [ProviderRow.vue](../apps/client/app/components/ProviderRow.vue)
- [ProviderCatalogue.vue](../apps/client/app/components/ProviderCatalogue.vue)
- [ProviderSetupDialog.vue](../apps/client/app/components/ProviderSetupDialog.vue)
- [ProviderReturnUrlDialog.vue](../apps/client/app/components/ProviderReturnUrlDialog.vue)
- [ProviderRemoveDialog.vue](../apps/client/app/components/ProviderRemoveDialog.vue)
- [providers.ts](../apps/client/app/stores/providers.ts)
- [providers.ts](../apps/client/app/utils/providers.ts)
