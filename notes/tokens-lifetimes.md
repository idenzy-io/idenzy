# Token and session lifetimes

Route: `/tokens/lifetimes` · [Page source](../apps/client/app/pages/tokens/lifetimes.vue)

## User task

I need to balance sign-in convenience and the time a stolen or revoked credential can remain usable.

## Keep

Keep the outcome calculations and distinction between idle and absolute session duration.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Token & session lifetimes                         [Current policy]
[Access token: 1m | 5m | 15m | 30m | 60m]
[Revoked token exposure] [Refresh estimate + assumptions]
[Session timeline................................................]
  Sign-in ---- active use ---- inactivity ---- earliest expiry
[Idle timeout v]                    [Absolute maximum v]
[Applies to: existing/new sessions...]         [Cancel] [Save policy]
[Other credential clocks | Value | Managed on | Open]
[Advanced assumptions v]
```

Keep the three primary controls together and show their combined outcome before Save policy. Put revocation integration status next to the exposure calculation, with Open revocation setup as a secondary link. Each other-clock row links to its actual owning page; do not turn fixed values into disabled fake inputs.

### Mobile arrangement

Put access-token duration, revocation outcome, idle control, absolute control and timeline in that order. Use a vertical timeline rather than a compressed horizontal chart. Save stays after the full policy group.

### Buttons, dialogs and states

No modal is needed for normal edits. A large consequential change gets an inline before/after review, naming existing versus new-session behavior. Display field errors at each boundary and retain the old effective policy until the grouped save succeeds.

## Findings and fixes

### P1 — Related pages disagree about which clocks are editable

The clock table calls password reset and step-up deployment-owned, while their own pages offer changes. Read their effective values and ownership from the same configuration and link to the owning editor. A table with confident but stale values is worse than a reference link.

**Closed for password reset, both halves.** The table stopped calling it deployment-fixed
when it began reading `passwordResetSeconds` off the passwords store, and the server
stopped making that claim true when `PasswordResetService` began reading
`password.resetLifetime` instead of `PASSWORD_RESET_TTL_SECONDS` — the environment variable
is gone. Step-up is still deployment-owned and this finding still covers it.

**And the idle window, which this page was right about and the server was not.** The copy
here says an idle window is read at the next rotation so it reaches sessions that exist,
against an absolute lifetime stamped at sign-in and never moved. `RefreshService` was
reading `SESSION_IDLE_TTL_SECONDS` at that rotation while `SessionService` stamped the
setting at sign-in, so the promise belonged to the environment. Worse, the two defaults
disagreed — fourteen days at sign-in, thirty on the first rotation — so an unconfigured
project's sessions silently changed window the first time they refreshed, in the direction
of lasting longer. Both session variables are deleted; the page's description of what
saving does is now true of the server.

### P1 — Revocation estimates need explicit assumptions

The page describes token-only delay, poll-based delay and suspension separately, which is useful. Keep those differences visible, and identify polling as observed for a particular integration rather than proof that every verifier is covered.

### P2 — The session model should be a timeline

Idle time, absolute age and refresh-token lifetime require comparing paragraphs. Show sign-in → continued use → inactivity, with the earliest ending highlighted. Preview what applies to existing sessions versus new sign-ins before saving.

### P2 — There are direct copy contradictions

The passkey challenge is described as longer than a one-time code while showing 5 versus 10 minutes. “Two people have to act” for an address change can imply two owners instead of one person confirming two inboxes. Replace narrative embellishment with accurate outcomes.

## Proposed page

Access-token duration and revocation exposure → session timeline with idle/absolute controls → effective clock table with links → advanced assumptions. Put the current practical outcome above refresh-cost arithmetic.

## Dialogs and interactions

No page-specific dialog. Reversible duration edits can remain inline; changes that materially shorten or lengthen access should show a before/after summary and application timing. Use one clear save model for a mutually constrained pair of durations.

## Acceptance checks

Change idle/absolute choices and verify the earliest boundary is understandable. Check every table value against its owning page. Explain whether an already-issued token or an existing absolute deadline changes.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [lifetimes.ts](../apps/client/app/stores/lifetimes.ts)
- [mfa.ts](../apps/client/app/stores/mfa.ts)
- [sessions.ts](../apps/client/app/stores/sessions.ts)
- [lifetimes.ts](../apps/client/app/utils/lifetimes.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
- [sessions.ts](../apps/client/app/utils/sessions.ts)
