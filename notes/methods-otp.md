# One-time codes

Route: `/methods/otp` · [Page source](../apps/client/app/pages/methods/otp.vue)

## User task

I need to choose how people receive a code or link and ensure the channel can actually deliver.

## Keep

Keep separate sign-up controls, the SMS prerequisites link, and previews of the message users receive.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
One-time sign-in
[Email code] [SMS code] [Magic link]

Selected channel:
[Ready / Setup incomplete]                         [Complete setup]
[Allow sign-in: switch] [Allow sign-up: switch]
[Channel configuration, 8 cols] [User message preview, 4 cols]
[Delivery / return URL prerequisites]
[Expiry | Attempts | Resend behavior | Cost]
[Save channel settings]               [Template] [Integration guide]
```

Place channel navigation below the title, then readiness before enablement. SMS shows countries, spend cap, vendor and attestation as linked checklist rows with one clear repair action each. Magic link shows the application return URL list and confirmation-route checklist. Put Add return URL at the list header's right. Separate template editing from method enablement.

### Mobile arrangement

Tabs may horizontally scroll with the selected label fully visible. Stack preview below controls and above advanced details. Keep channel title and state visible when moving between sections.

### Buttons, dialogs and states

Return-URL dialog: full application URL → example → exact-match result → note about separately allowing its origin. Footer Cancel / Add return URL. Saving channel settings should summarize the sign-up behavior and any remaining blockers.

## Findings and fixes

### P1 — Three different flows share one long settings surface

Email codes, SMS codes and magic links have different prerequisites and customer experiences. Use channel tabs or distinct compact setup panels with their own status, message preview and required next action.

### P1 — A switch is not enough to enable SMS or magic links

SMS depends on method settings, country policy, delivery credentials and potentially attestation; magic links need registered return URIs and the customer's confirmation route. Summarize these dependencies beside Enable rather than making users reconcile several pages.

### P1 — The return-URI flow is too easy to confuse

Magic-link return URL, provider callback, CORS origin and passkey origin are different. MagicLinkRedirectDialog should use a full example and “Where your app receives the sign-in result”; suggest adding its origin separately with explicit confirmation.

### P2 — Technical exposition obscures user-visible timing

“Every code” discusses SQL ordering, hashing and entropy. Lead with expiry, attempts, resend behavior and cost. Show a short sample journey and put implementation details in the guide.

## Proposed page

Choose Email code / SMS code / Magic link → readiness checklist → allow sign-in/sign-up → user message preview → test integration. Treat WhatsApp as a clearly unavailable future channel.

## Dialogs and interactions

MagicLinkRedirectDialog: field “Application return URL,” example https://app.example.com/auth/callback, exact-match validation and action “Add return URL.” Explain that adding a URL does not implement the receiving route or permit CORS automatically.

## Settled while implementing

The mockup's `Save channel settings` is not built, and deliberately. Everything a channel
holds is a switch or a list edit, which the [layout blueprint](layout-blueprint.md) says
writes immediately, and it also says a page with independent inline saves must not offer a
misleading Save everything. What the note wanted from that button is the summary, so the
summary is permanent: the channel's foot states the sign-in and sign-up behaviour in a
sentence and counts what is still blocking delivery, beside Template and Integration guide.

Magic links gained an `allowSignUp` of their own, so all three channels answer the same two
questions. WhatsApp is a fourth tab rather than a row inside SMS, because a channel somebody
is looking for has to be findable before it can be explained.

## Acceptance checks

Enable a channel with missing prerequisites and receive a clear setup path. Add a magic-link URL and identify where the confirmation screen belongs. Check sign-up-disabled copy distinguishes code delivery from permission to create an account.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md). Findings describe the current prototype; proposed behavior requires implementation and usability validation.

## Implementation references

- [MagicLinkRedirectDialog.vue](../apps/client/app/components/MagicLinkRedirectDialog.vue)
- [otp.ts](../apps/client/app/stores/otp.ts)
- [sms-policy.ts](../apps/client/app/stores/sms-policy.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
- [sessions.ts](../apps/client/app/utils/sessions.ts)
- [sms-policy.ts](../apps/client/app/utils/sms-policy.ts)
