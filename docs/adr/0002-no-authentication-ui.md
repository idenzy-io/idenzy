# ADR-0002: We ship no authentication UI

- Status: accepted
- Date: 2026-09-03

## Context

The obvious playbook for this category is Clerk's: ship excellent prebuilt components, make the demo
three lines long, and charge for it. Our first draft followed it, with hosted auth pages on
`auth.customer.com` and an embeddable component library as the "five-minute setup" story.

## Decision

**Idenzy ships a backend and SDKs. We do not ship authentication UI of any kind**: no hosted pages,
no embeddable components, no widgets, no iframes. The auth API returns JSON and HTTP redirects. The
sign-in screen belongs to the customer's application.

This is a product boundary, not a phasing decision. There is no later phase in which we add
components.

## Rationale

**The honest division of labour.** A sign-in screen is the most brand-sensitive surface in most
products. Teams that care replace the vendor component eventually. Shipping one buys a good demo and
then becomes a permanent theming-API maintenance obligation.

**It removes an attack surface.** We render no HTML on any customer-facing surface, so XSS,
clickjacking, CSS injection and open-redirect-via-template against our pages do not exist. There is
no script of ours on the customer's sign-in page. PROJECT.md §4.3 makes this testable: an auth
endpoint returning `text/html` is a bug with a test asserting against it.

**It is the largest cost line we can decline.** Components across React, Vue, Svelte, Angular,
Flutter, iOS and Android, themable, localized into 30+ languages, accessibility-audited and versioned
forever, is a permanent team. That cost is visible in Clerk's $0.02/MRU. We spend it on being 8 times
cheaper and on platform breadth instead.

**It makes platform breadth survivable.** Unity, Godot and Kotlin Multiplatform SDKs are not
second-class citizens waiting on a UI toolkit, because there is no UI to port. A headless SDK is
small enough that one engineer can maintain several.

## What we do instead

Typed headless primitives per framework, framework middleware for the boring parts (route protection,
SSR session reading, silent refresh), an `idenzy init` CLI that scaffolds working auth routes **into
the customer's own repository**, and per-framework quickstarts.

The line that keeps this honest: **code the customer copies into their repo and owns is not a
component we publish and control.** Scaffolded routes have no version coupling to us and nothing of
ours in the render tree. We never ship a versioned artifact whose job is to render auth UI.

## Consequences

- `apps/hosted-ui` does not exist. `packages/ui` serves only our own three panels and is never
  published.
- Magic links redirect to a customer-registered URL rather than to a page of ours, so the anti-scanner
  confirmation click becomes a route in their app (PROJECT.md §4.7).
- Email OTP becomes the default passwordless flow, since it needs no page anywhere.
- TOTP enrolment returns an `otpauth://` URI and the secret; the customer renders the QR code.
- Error codes carry more weight than in a UI-shipping product, because the customer builds every
  message from them. They are stable, documented and generated from `@idenzy/protocol`.
- We dogfood: our own `client` and `admin` panels use `@idenzy/nuxt` to build their sign-in screens.
  If that is painful for us, it is painful for customers, and the fix is a better SDK.

## The cost, stated plainly

Time-to-first-login is longer than Clerk's, and we lose the "look, three lines" demo. PROJECT.md §15
records this as a tracked risk with a measured metric: time from signup to first successful auth,
target under 15 minutes. If that number does not come down, the answer is better scaffolding and
documentation, not a component.
