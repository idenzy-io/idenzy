# Getting started

Route: `/getting-started` · [Page](../apps/client/app/pages/getting-started.vue) ·
[Layout](../apps/client/app/layouts/onboarding.vue) ·
[Guard](../apps/client/app/middleware/session.global.ts)

## User task

Somebody has just created an account and owns nothing. Give them a project, and get out of
the way.

## Why it exists at all

An organisation with no project is a dead end. Every screen in this panel is scoped to a
project, so a dashboard reached without one is a drawer of links that all render empty —
and each of them would need an empty state written for a case that lasts one minute. The
guard closes the dashboard until this is done and closes this page once it is, in both
directions: a form that creates things must not stay reachable for somebody who only wanted
to look.

Somebody who arrives by invitation never sees it. They joined an organisation that already
has projects, and asking them to make another is asking them to solve a problem they do not
have. The test is membership and not project count, which is what `GET /v1/onboarding`
answers.

## Proposed mockup

### Step 1 — Your project

```text
Create your first project
A project is one application and the users who sign in to it.

(1) Your project ——— (2) About you
────────────────────────────────────
Project name
[ My application                    ]
A label for this dashboard. Nobody signing in to your application ever sees it.

                                          [ Continue → ]
```

### Step 2 — About you

```text
One or two optional questions
This helps us decide what to build next. Skipping it changes nothing.

(✓) Your project ——— (2) About you
────────────────────────────────────
What are you building?      [ pick or type ▾ ]
How did you hear about us?  [ pick or type ▾ ]
Organisation name (optional)[ Acme Checkout   ]
Your team, your billing and your invoices belong to this.

[ Back ]                    [ Skip and create ]  [ Create project ]
```

## Findings and fixes

### P1 — ~~The two halves are not equally binding~~

**Moot since 2026-09-21.** This finding was about the region: a name is editable for ever,
a region was pinned at creation, and putting both on one page made every field look the
same weight. Region cells are gone (PROJECT.md 4.13.5), so step one now asks one question
and nothing on this page is irreversible. The two steps remain, for the weaker but still
real reason that a survey mixed into the form that creates the project reads as part of
creating it.

### P1 — Nothing may be written before the form is finished

The whole flow is one `POST /v1/onboarding`, which creates the organisation, its owner and
the project in one transaction. Somebody who abandons the page leaves no rows, and an
account that never finished is exactly as it was. A step that wrote as it went would leave
orphaned organisations belonging to people who changed their mind.

### P2 — A flow with no exit is a trap

The layout offers the signed-in address and a way to leave it. Somebody who registered with
the wrong account, or who meant to accept an invitation instead, would otherwise be stuck on
a page whose only button creates something they do not want.

## Settled while implementing

**The region question is gone.** It asked "where should this project's data live" rather
than "what country are you in", which was the right framing for a question we no longer ask:
residency is not offered (PROJECT.md 4.13.5). The `ChoiceList`, the flags and the "pinned at
creation" warning went with it.

**The optional answers are a list before they are a box.** A list gets answered; an empty
textarea gets skipped. Both still take a written answer, because the useful ones are the
ones nobody put on the list.

**The dropdown is not `nav`.** `.v-list--nav` mutes an item until it is hovered, which is
right in the drawer, where one place is current and the rest are elsewhere. In a menu of
answers nothing is elsewhere, and the ladder that matters is title over subtitle. The
options carry an icon and a subtitle through `item-props`, the way every other dropdown in
the panel draws itself.

**The organisation takes the project's name when nobody gives it one.** A personal
organisation is often never renamed, so the fallback has to be something its owner
recognises on their own dashboard rather than "Untitled".

**This screen is drawn in the signed-out language, not the panel's.** Square corners and
fields that are a value over a hairline, the same as sign-in — because this is the other
shell that is one column with one thing to do, and a person meets the two within a minute
of each other. Both layouts carry `flow-shell`, which zeroes the radius ladder rather than
flattening anything itself, so `ChoiceList` and `InfoNote` go square here and stay rounded
on the fourteen panel screens that also use them. What this screen does **not** take is
`auth-shell`: that repaints `color="primary"` as ink, which is right where the only accent
is the sign-in button and wrong on the first screen behind it, where the product's blue
starts.

## Acceptance checks

- The dashboard is unreachable with no organisation, and this page is unreachable with one.
- Continue is refused until the name is answered; the name's error replaces its helper
  rather than stacking under it.
- Skipping the second step creates the project and stores no survey row at all.
- Leaving the page at any point writes nothing.

## Implementation references

- Domain rules and copy: [utils/onboarding.ts](../apps/client/app/utils/onboarding.ts)
- Store and the call: [stores/onboarding.ts](../apps/client/app/stores/onboarding.ts)
- Server: `POST /v1/onboarding` in
  [apps/api](../apps/api/src/management/onboarding/onboarding-service.ts)
