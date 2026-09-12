# The panel, screen by screen

One section per screen: what was settled while building it and why, over and above the
specification in `notes/`. Read the screen's note first, then its section here, then
[panel.md](./panel.md) for the conventions they all share.

| Route | Section |
| --- | --- |
| `/methods/passwords` | [passwords](#working-on-the-passwords-screen) |
| `/methods/passkeys` | [passkeys](#working-on-the-passkeys-screen) |
| `/methods/otp` | [one-time codes](#working-on-the-one-time-codes-screen) |
| `/methods/providers` | [social providers](#working-on-the-social-providers-screen) |
| `/mfa/totp` | [authenticator](#working-on-the-authenticator-screen) |
| `/mfa/recovery` | [recovery codes](#working-on-the-recovery-codes-screen) |
| `/mfa/step-up` | [additional-verification](#working-on-the-additional-verification-screen) |
| `/tokens/lifetimes` | [lifetimes](#working-on-the-lifetimes-screen) |
| `/tokens/claims` | [claim templates](#working-on-the-claim-templates-screen) |
| `/domains` | [auth domains](#working-on-the-auth-domains-screen) |
| `/domains/origins` | [allowed origins](#working-on-the-allowed-origins-screen) |
| `/email/domains` | [sending domains](#working-on-the-sending-domains-screen) |
| `/email/suppressions` | [blocked addresses](#working-on-the-blocked-addresses-screen) |
| `/email/templates` | [email templates](#working-on-the-email-template-screens) |
| `/sms/policy` | [SMS policy](#working-on-the-sms-policy-screen) |
| `/sms/providers` | [SMS providers](#working-on-the-sms-providers-screen) |
| `/keys` | [API keys](#working-on-the-api-keys-screen) |
| `/webhooks` | [webhooks](#working-on-the-webhooks-screen) |
| `/hooks` | [hooks](#working-on-the-hooks-screen) |
| `/security` | [security centre](#working-on-the-security-centre) |
| `/audit` | [audit log](#working-on-the-audit-log) |
| `/data-requests` | [data requests](#working-on-the-data-requests-screen) |
| `/usage` | [usage](#working-on-the-usage-screen) |
| `/billing` | [billing](#working-on-the-billing-screen) |
| `/settings` | [settings](#working-on-the-settings-screens) |

## Working on the passwords screen

`/methods/passwords` follows `notes/methods-passwords.md`: the figures under the title, the
method switch and its effect, the requirements editor beside the preview of what it makes,
reset and sessions, then the failed-attempt controls. Single column, full width, no rail.

- **Two save models on one screen, and the difference is typing.** The switches and the
  reset controls write the moment they change, because each is one discrete state. The
  requirements are a draft with `Save requirements` at the section's bottom right and
  `Cancel changes` to its left, because a minimum length is typed a digit at a time and
  saving the "1" of a "12" refuses every password on the project until the "2" lands.
- **The preview follows the draft, not the saved policy.** "What users must enter" is the
  same `requirementsOf` the SDK's error codes map to, rendered from the unsaved values, and
  it says so while they are unsaved.
- **A folded card carries its saved values in its heading.** `requirementsSummary`,
  `resetSummary` and `attemptsSummary` in `utils/password-policy.ts` are what the strip
  shows when a card is closed, so nobody has to open three cards to read the policy.
- **Two switches ask first, and each names its own number.** Turning the method off can
  strand every account holding no other credential, so `PasswordDisableDialog` states how
  many that is and what the project still offers; turning lockout on hands anybody who
  knows an address a way to lock its owner out, so `PasswordLockoutDialog` says both halves
  of that trade. Turning either back the other way asks nothing.
- **What a project cannot change is not on the screen.** The hash, the pepper and the
  normalisation moved out to the docs rather than into a card nobody can act on.

## Working on the passkeys screen

`/methods/passkeys` is a setup screen and not a settings one, and it is the model for any
method whose configuration can be right and still not work. The blocks run in one column:
what is blocking, the three things a customer decides, a check that says why a browser
would refuse a ceremony, the figures, then the WebAuthn rules folded away. No right rail,
as on passwords, one-time codes and providers: a method screen is read top to bottom and a
rail of figures beside it competes with the thing that is blocking.

- **It speaks the reader's words, and WebAuthn's only in brackets.** The rows are
  "Passkey domain (RP ID)", "Product name" and "Allowed application URLs", and the four
  dialogs use the same names. An operator who has never read the spec has to be able to
  set this up; a reviewer who has needs to know which field is the RP ID, which is what
  the bracket is for.
- **The setup check exists because two of the four things it checks are on other
  screens.** A URL that is not also on the CORS allowlist is refused by the browser with
  nothing in our logs to explain it (ADR-0006), and a project nobody has integrated looks
  exactly like one whose integration is broken. `evaluateSetup` in `app/utils/passkeys.ts`
  is pure and reads what the panel already holds, so the answer changes the moment a
  setting does and `Test setup` is a re-read rather than a request.
- **A blocker is a configuration gap, a check finding is a diagnosis.** `setupBlockers`
  answers the header badge and the strip at the top, which disappears when it is empty;
  the check card is hidden until there is a relying party, so exactly one of the two leads
  at a time.
- **A relying party is created in a dialog and never as a form on the page.** Its three
  fields are validated against each other and written as one record: an origin is only
  valid on the RP ID's domain, and a party with no origin refuses every ceremony.
- **The figures are `Statistic` tiles with one short line each.** A description that wraps
  in one tile and not the next makes four tiles read as four different objects, so what a
  figure does and does not count goes in `info` behind the glyph. No sparkline tiles here.
- **The authenticator breakdown is cards, not a chart.** A row of bars and a bar chart were
  both tried and both rejected; it is now one `Statistic`-shaped card per authenticator, the
  mark and the name as the label, the count as the figure, and where those passkeys live
  under it. The label is not `capitalize`d as the tiles above are, because CSS would turn
  iCloud Keychain into ICloud Keychain.
- **A single-colour authenticator logo is tinted, never inverted.** `Authenticator.tint`
  carries a class off the `--idenzy-mark-*` tokens in theme.css, stepped per theme like the
  platform marks beside them. Inverting a brand mark turns a blue logo white in one theme
  and black in the other, which leaves the shape doing all the work. A tint only reaches a
  mark drawn in `currentColor`, which is why Apple's is `simple-icons:apple` here and not
  `logos:apple`: the `logos` body paints a fixed black that no class can touch. Check the
  collection before assuming a colour class will land.

## Working on the one-time codes screen

`/methods/otp` follows `notes/methods-otp.md`: the channel is the first decision, so the tabs
sit under the title and everything below them belongs to the channel on show. Email, SMS and
magic links are three integrations rather than three switches, which is the whole reason the
screen is shaped this way.

- **Readiness comes before enablement, and most of it is on other screens.** `channelChecks`
  in `app/utils/otp.ts` is pure and reads what the panel already holds, so a prerequisite
  answers the moment a setting changes elsewhere. Every row names the screen that settles it:
  the sending domain, the country allowlist, the spend cap, the delivery account, attestation,
  the CORS allowlist. A failing check is what the badge calls setup incomplete, and `Complete
  setup` goes to the first one.
- **Off is a decision and not a fault.** A channel nobody turned on says `Off` rather than
  listing what would be wrong with it, and the header badge names the channel that is on and
  stuck, because a reader on the email tab must not have to open the SMS one to find out.
- **The channel's foot is the save summary.** Every control here writes at once, so there is
  no `Save channel settings` however the note's mockup draws it; what that button was for is a
  permanent sentence stating the sign-in and sign-up behaviour and counting what is blocking.
  `notes/methods-otp.md` records the trade under "Settled while implementing".
- **What a user feels leads, and how a code is stored follows.** Expiry, wrong guesses, what
  asking again does and what a send costs are four `LifetimeOutcome` figures in a strip; the
  entropy, the hash and the single-use rule sit folded at the foot of the page.
- **A return URL is not a CORS origin, and adding one never adds the other.** The dialog shows
  the whole example, states the string the server will compare, and offers the origin as a
  separate box that is off until somebody ticks it (ADR-0006). A native scheme has no origin
  and a loopback one cannot be allowed, so neither counts against the check.
- **The tab lives in the query,** so a screen somebody is asked to look at can be linked to,
  and it is replaced rather than pushed: moving between tabs is not navigation to step back
  through.
- **WhatsApp is a tab that cannot be turned on.** It is already a name in the SDK's channel
  enum and the first thing an operator looks for after SMS, so it is findable and says what it
  is not, rather than being left out and hunted for across three screens.

## Working on the social providers screen

`/methods/providers` follows `notes/methods-providers.md`. It is an integration screen and
not a settings one: what is blocking, the providers and the state each is in, the return
URLs they share, whether the whole thing works, then the linking rule. Single column, like
passkeys, and the catalogue is not on the page at all.

`app/utils/providers.ts` is the panel's catalogue of the eighteen adapters registered in
`apps/auth-api/src/oauth/oauth.module.ts`, plus the generic OIDC connector, which is shown
grey because "not supported" and "not yet" read differently. `app/utils/auth-providers.ts`
derives the four marks our own sign-in screens use from it, so there is one answer to what
Google looks like.

- **Configured and working are different questions, and `readinessOf` is the answer to the
  second.** A provider is `incomplete`, `off`, `development`, `untested` or `ready`, in that
  order of precedence: a gap outranks a decision because switching on a provider that cannot
  exchange changes nothing, and a decision outranks a restriction because a provider nobody
  can reach is closed rather than localhost-only. The row leads with that state and its
  button is named after it, so Manage, Finish setup and Use your own app are the same
  control saying which of three things it is for.
- **`untested` is a statement and not a fault, and the test is a real sign-in.** Whether the
  provider console holds our callback is the one thing this end cannot see: a wrong redirect
  URI is refused at their consent screen, before we are called. So the workspace's last step
  says that beside the checks it *can* run, and starts a real sign-in. Where it can: a
  top-level navigation resolves a project by `Host` alone, so only a project with a verified
  custom auth domain can be sent to the start route, and one on the shared API host gets the
  SDK call to run from its own application. `testedAt` records that a sign-in was run, never
  that it passed, because where it ended is the customer's return page and not ours.
- **`email` is the field the catalogue file exists for.** Whether a provider asserts the
  address it hands over is verified is what decides whether a sign-in may join an account
  somebody already has (PROJECT.md 4.6). Ten of them state it and eight do not, and the
  eight report unverified because their provider states nothing rather than because nobody
  checked. It is on the row and worked through on the linking card, and deliberately *not*
  on eighteen catalogue cards: it appears in the workspace once a provider is picked, which
  is the first point a reader can act on it.
- **Two different URLs both called a redirect, and they get a step each.** Ours
  (`/v1/auth/oauth/:provider/callback`) is fixed by the deployment and goes in the provider
  console; theirs is a row of `redirect_uris` under the `oauth` kind and is where we send the
  browser afterwards with a code. Registering one where the other belongs is how a first
  setup fails, and it fails at the provider's consent screen where the user sees an error and
  the operator sees nothing. Neither is a CORS origin, and the return-URL dialog offers that
  origin as a separate tick (ADR-0006), never as a consequence.
- **The return URLs belong to the project, not to a provider.** One list, shared by all of
  them, because the code is ours whichever provider minted the identity. It has a card on the
  page as well as a step in the workspace, since the blocker and the check both need
  somewhere to send a reader. Those URLs are a third source for the Allowed origins screen's
  suggestions, which is why `suggestionsFrom` is keyed by source rather than positional.
- **A provider that is on and incomplete is a page-level blocker.** It fails after the user
  has already agreed at the provider, which is the one failure invisible from both ends, so
  `providerBlockers` raises it by name with the missing field.
- **The client secret goes one way.** The panel holds `secretSet` and when it was written,
  never the value, so the field on an existing provider is a replacement and a blank one is
  a keep. Clearing is not offered: a provider without a secret cannot finish a sign-in, and
  removing it from the project is the honest way to say that.
- **Credentials are one write and everything else writes itself.** A switch, the linking
  rule and a return-URL edit save on the spot like the passwords and passkeys screens; the
  credential set goes through the workspace because a provider half saved fails at the token
  endpoint rather than in the panel. Same reason the passkey relying party is one write.
- **Opened over a provider that exists, the workspace is tabs and not a funnel.** `Steps`
  takes a `reached` id for that: somebody rotating a secret must not walk past two steps they
  are not changing. Adding one stays a funnel until the credentials are written.
- **Both credential fields are named and the secret is `new-password`.** A text field
  followed by a password field is a sign-in form as far as a browser is concerned, and it
  will put the operator's own address in the client id and their panel password in the
  secret, which saves cleanly and fails at the provider.
- **Instant mode is shown as a warning wherever it appears.** It is our shared app, our name
  on the consent screen, and refused anywhere but localhost and preview domains, so a row on
  it says so in full rather than wearing a quiet pill.
- **Removing a provider keeps the identities.** What comes off is the credentials, so
  setting it up again recognises everybody who used it. What the dialog states is the number
  of accounts with no other way in, because for them a removal is the account.

## Working on the authenticator screen

`/mfa/totp` follows `notes/mfa-totp.md`. It is the screen where the panel's own words are
most likely to mislead, so most of its shape is about one sentence: available is not
required.

- **The badge says whether the method exists and the strip says who is challenged.** They
  are different questions and the second one's answer is a count, which is why
  `scopeSummary` in `app/utils/mfa.ts` writes it out with both sides in it: the accounts
  that enrolled one and are asked for a code, and the accounts that sign in with one
  factor. A green badge alone reads as "every user must enrol".
- **Requiring it of everybody is a row that says `Not yet`, never a switch.** A challenge
  in front of an account holding nothing is a sign-in that cannot be completed, so the
  requirement waits on an enrolment step inside sign-in. `MfaChallengeGate` answers null
  for a user with nothing enrolled, which is the same decision on the server.
- **The factor model is a matrix and not prose.** `challengeScenarios` is six cases in the
  reader's words with a three-word answer each, and it replaced two cards that explained
  demanding and answering in ours. Its foot carries the two things no row can: that one
  gate decides for every flow, so a sign-in method added later is challenged on the same
  terms, and that while the method is off no row applies today.
- **The name is a draft; the switch is not.** A name is typed, so it saves through Save
  name with Cancel changes beside it and the preview follows the draft. The switch is one
  state and writes at once, except off, which goes through `TotpDisableDialog` because it
  stops a code being asked for on every account that holds one and only a dialog can state
  the number.
- **Following the project's name is a choice, not a blank field.** Null carries a later
  rename of the project along and a typed name holds still, so the two are a segmented
  control and the field belongs to the second one.
- **The sample secret is behind a disclosure and labelled a sample.** A page about second
  factors that shows a secret is a page an operator reads as their own enrolment; the panel
  says so and points at Account, which is where their own authenticator lives.
- **There is no setup check, deliberately.** An authenticator needs nothing but a session,
  so unlike passkeys and one-time codes there is no prerequisite on another screen for a
  check card to go and read.

## Working on the recovery codes screen

`/mfa/recovery` follows `notes/mfa-recovery.md`. It is a support queue first and a settings
screen barely at all: find the accounts about to lose access, and hand the operator the only
safe way to fix one. `app/utils/recovery.ts` states what the server decided and reads what
it shares with the authenticator screen out of `app/utils/mfa.ts` rather than writing it
again: the count of codes, the attempt cap and the challenge's lifetime are one fact each.

- **"Sheet" is not the word, in the copy or in the code.** A customer reads recovery codes,
  so the noun for the ten of them is a *set*: `RecoverySet`, `CODE_SET`, `setsFor`,
  `clearCodes`. The rename went through the store and the user detail page on purpose,
  because a screen whose labels and source disagree drifts back.
- **The queue is the page, and it opens on the accounts with nothing left.** An account
  holding a second factor and no unspent code is a support ticket that has not happened yet.
  The other two segments carry their counts, the search covers name, email, phone and id,
  and the base order is fewest codes first so the row the detail panel opens on is the row
  at the top.
- **A row's own action is View, never Clear.** Clearing somebody's codes is not the remedy
  for somebody who has none, which was the finding this screen was rebuilt for.
  `RecoveryAccountCard` leads with what the account holds and what its owner has to do,
  written to be pasted into a ticket; invalidating what is left sits behind an Advanced
  fold. It is mounted twice, inline from `lg` up and in a full-height dialog below it.
- **There is no "generate a set for them", and there will not be.** The codes are returned
  exactly once and only digests are kept, so an operator who could regenerate would be
  handed ten working credentials for an account that is not theirs. `nextStepFor` says the
  honest thing instead: they can still sign in with the factor they hold, and if that goes
  first, nothing here can let them back in.
- **A set nobody generated and a set spent to the last code both read as zero to the
  server**, because `countUnused` is all it publishes. `remainingLabel` is the panel saying
  which is which: "Never generated" against "No codes remaining", never a bare "0 of 10".
  Both are written out beside the pips, because a bar of colour is not a state.
- **The clear dialog is two decisions with one set of mechanics.** With codes unspent it is
  `Invalidate N codes` behind an acknowledgement; with none it is `Clear spent codes` with
  the acknowledgement dropped and a line saying this restores nothing. Asking somebody to
  tick a box about a loss that already happened teaches them to tick boxes.
- **The threshold is the dashboard's, not the server's.** It decides which accounts this
  screen and the security centre flag as running low and nothing else, so it is named
  "Warning threshold" and its dialog says the server never reads it. A sign-in behaves the
  same whether an account has ten codes or one.
- **`Notify user` is shown switched off, with the reason under it.** There is no audited
  send behind it, and a queue that silently lacks the obvious action reads as a missing
  feature nobody explained. Copy instructions is what actually works.
- **The placeholder sets are derived from the users store**, seeded by user id. The accounts
  with a second factor are the accounts with codes, so two independently invented sets of
  people would disagree the moment somebody compared this screen with the users list.

## Working on the additional-verification screen

`/mfa/step-up` follows `notes/mfa-step-up.md`. The screen is called Additional verification
in the drawer, the breadcrumb and the title, with "step-up" as the first word of the
description: it is the reader's name for it, and `PageHeader` truncates one line, so a
parenthetical in the title is what a phone cuts. `app/utils/step-up.ts` holds the facts.

- **Coverage comes before the control, because a window is not enforcement.**
  `assertRecent` lets a user holding no passkey and no authenticator past, so a
  fifteen-minute window protects exactly the accounts that enrolled something.
  `stepUpCoverage` counts both sides and the strip under the tiles states the gap by name,
  above the setting rather than under it. Asking for the password instead is the honest fix
  and is not built: the screen says so and never implies otherwise.
- **`canBeChallenged` is a passkey or an authenticator, and nothing else.** That is
  `MfaFactorRegistry.forPurpose(StepUp)`, which offers those two in that order; a recovery
  code answers a sign-in and never a step-up, so an account holding only codes is an account
  that passes.
- **The matrix is the fix for one claim over four unlike rows.** `STEP_UP_ACTIONS` marks each
  as `enforced`, `sdk`, `yours` or `unavailable`, and exactly one row is `enforced`:
  `POST v1/auth/account/email` is the only route of ours that calls `assertRecent`. A test
  asserts that count, because "protected" over a mixed list overstates every row on it.
- **The security centre's challenge and a step-up are different things, and the matrix says
  so.** A detector rule answers the *sign-in* with a challenge (the MFA gate); nothing raises
  a step-up inside a session that already exists. That distinction is why the two screens
  read as disagreeing, so the row names both halves and links to the one that owns the first.
- **The window is a draft with Save beside it, not a control that writes itself.** It is
  small and reversible, so the note asks for no dialog; the footer states the before, the
  after and that it applies to the next action anybody attempts. The example under it is one
  person's afternoon rather than a table of ages: `walkthrough` returns a proof, an action
  inside the window, the same action past it and the answer that restores it, with the line
  the window draws rendered between the second step and the third. Every age comes off the
  draft and every step's freshness comes from `isProofFresh`, so the story cannot drift from
  the check it illustrates.
- **The client and server halves of the example live together, and each says what its null
  means.** A null challenge is "nothing to ask this caller for"; a null `fva` is "no proof
  can be given". Collapsing them into "allow" is how the check stops being one, so the
  server half refuses before it allows and is written against the project's own window.

## Working on the lifetimes screen

`/tokens/lifetimes` follows `notes/tokens-lifetimes.md`. Three numbers a project decides,
in one group, and every other clock in the product as a reference table.

- **The three save as one policy, unlike the settings screens either side of it.** The
  idle window and the maximum lifetime constrain each other and the access-token lifetime
  decides what both cost, so a draft with `Cancel changes` and `Save policy` is the one
  save model for the three. A control that wrote itself would answer "what do these do to
  a session" once per keystroke from a policy that was never all there at once. The
  header badge stays on the *saved* policy while the card follows the draft, so what is in
  force is readable at every moment.
- **`policyChanges` exists because the three do not reach a session the same way.** An
  idle window is read at the next rotation, so it reaches sessions that already exist; a
  maximum lifetime is stamped at sign-in and never moved, so shortening it changes nothing
  for anybody signed in today. A screen that said only "saved" would leave an operator
  believing they had just shortened sessions they had not touched, and the review above
  the button says which is which per field.
- **`sessionTimeline` is deliberately not to scale, and says so.** The only interesting
  thing about three durations is which arrives first, and drawn to scale a one-day idle
  window against a one-year maximum is a stop sitting on the sign-in. Evenly spaced, the
  order survives every combination the controls offer. `SessionTimeline` is horizontal
  from `lg` and vertical below, and the last stop keeps a faded rail of its own: a line
  that stops three quarters across a row reads as unfinished, and a line that faded is not
  a line that continues.
- **`clockRows` takes the clocks other screens own as arguments.** This list used to keep
  its own copy of the password-reset window and call it deployment-fixed while the
  passwords screen offered a control that moved it. `FIXED_CLOCKS` is now the deployment's
  clocks only, the one-time-code family reads its lengths from `CODE` in `~/utils/otp`,
  and the step-up window and reset link come in from their own stores with a link to the
  screen that owns them. A table with confident, stale values is worse than no table, and
  a fixed value drawn as a disabled input is a control that lies about being one.
- **The revocation window is observed, never promised.** What the panel can see is that
  one integration polled the snapshot; that is not proof every verifier a customer runs
  holds a `RevocationCache`, so the card says "observed for one integration" and states
  what a verifier without one still waits out. Rounding that up to a project-wide
  guarantee would be selling one out of a single observation.

## Working on the claim templates screen

`/tokens/claims` follows `notes/tokens-claims.md`. It is the one screen in the panel that
does not save itself, and most of its shape is about saying so.

- **A persistent toolbar, and the words on it are the design.** It sticks under the app bar
  and carries the count of unpublished changes, Discard and **Publish template**. The dialog
  that adds a claim says **Add to draft**, never Add or Save. A first button that looks like
  publication is the misreading the note was written about, and a screen that reads like the
  autosaving ones beside it is how that happens.
- **A draft is held per project and never published into another one.** `commit` names the
  project it read the draft from, leaving the route asks first and so does closing the tab.
  The leave dialog offers Publish and leave, but only where publishing would go straight
  through; where it would not, it says which problem is in the way rather than leaving a
  missing button to be interpreted.
- **Required is a per-row control because it can refuse a sign-in.** A required claim that
  resolves to nothing answers `claim_template_unsatisfied`, so the consequence is written on
  the row rather than parked behind a tooltip, and the row's name and source are opened in a
  dialog instead: four controls fighting for one line is what put a claim's name in a field
  that wrapped under its own source at every width the panel is read at.
- **Three sample users, and the two that hold nothing are the point.** `profileOutcomes`
  renders the draft against a complete profile, an account that signed up a minute ago and
  one that signed up by SMS and has no address at all. A template judged against one
  synthetic complete profile is a template nobody has checked, so a refusal is a page-level
  strip naming who it locks out and the cards under the panes carry each verdict.
- **The preview is a before and an after.** `tokenLines` marks every custom line against what
  the published template renders for the same user, and the marks ride on Shiki's own line
  elements through a transformer: the block has to be tokenised whole, because a lone
  `"plan": "pro",` is not JSON and a grammar handed one line at a time reads its key as an
  ordinary string. Every line but the last takes a comma for the same reason. A changed line
  is tinted the colour of its change and carries the glyph as well, because a tint alone is
  not a statement. Nothing marks which lines are the template's and which the issuer's:
  dimming the issuer's held most of the payload under an opacity and read as disabled, and a
  bar in the accent down the custom lines was a blue stripe beside the only colours on the
  block that mean anything. Both were tried and both came out.
- **`ClaimTokenPreview` draws the block in the add-claim dialog too**, over the draft's own
  claims with the new line marked, and that is the point of it: a claim *is* a line in a
  payload somebody's code reads, and the row of labelled values this replaced asked the
  reader to assemble a token in their head. A refusal replaces the payload rather than
  floating over a greyed-out copy of it, because there is no token to show and a dialog has
  no height to float anything over anything.
- **The acknowledgement names keys and values, once, at publish.** It lists each mapped
  private key beside the value a token would actually carry for a sample user, and says the
  sentence a reader otherwise supplies for themselves and gets wrong: a token is signed, not
  encrypted, so the signature says nobody altered these values and nothing about who can read
  them.

## Working on the auth domains screen

`/domains` follows `notes/domains.md`. The host in force, what the transport can do with it,
the figures, the list, then the setup behind a row.

- **An auth domain is an API host and never a page.** `auth.customer.com` is a CNAME at our
  load balancer that a customer's own React or Nuxt page sends `fetch` calls to. "You need
  an auth domain" reads as "we host your sign-in screen", which is the one thing this
  product does not do (ADR-0002), so the screen says what it is not before it asks for
  anything.
- **The capability rows are states, not refusals.** Header mode on the shared host is a
  legitimate integration; `cookieModeState` answers `Requires a custom domain` with the
  control that starts it, and reserves the unhappy words for a domain that was added and did
  not verify. "Cookie mode: Refused" over a working project reads as an incident report.
- **Verification is not migration, and the last two steps exist to say so.** A verified host
  changes no deployed base URL and makes no unrelated origin same-site. `authSetupStage`
  therefore stops at `sdk` on a verified domain and never advances itself past it, while
  `reached` lets the reader walk to the test anyway — gating the check on something we
  cannot observe would make it unreachable for exactly the domain it is for.
- **`setupProbe` is pure, and its fourth line is the point of it.** Three lines are ours to
  observe; the fourth says the named origin is on the CORS allowlist and explicitly not that
  a deployed client is calling this host. Tests pin that wording, because a green tick over
  four lines is what would hide it.
- **Every copyable endpoint is `apiBaseUrl` over the project's own domains.** One derivation
  across this screen, General, revocation and the OAuth examples; an illustrative value is
  labelled `Illustrative` rather than left to look configured.
- **A figures strip with nothing in it is still worth drawing.** Requests are not metered per
  host, so Connected applications uses `UsageTile`, which draws the faint wave and `No data`
  in words, with a line saying what is registered rather than observed.

## Working on the allowed origins screen

`/domains/origins` follows `notes/domains-origins.md`. It is a diagnosis screen, because a
missing entry fails silently: the API answers normally, the browser discards the response,
and the customer reads it as the SDK being broken.

- **An empty answer here is not evidence, and the screen says so.** Nothing records the
  `Origin` on a request, so the figures read no data, `Last observed use` says "Not
  recorded", and `unknownFor` returns nothing while `ORIGIN_TELEMETRY` is false. On this
  list a false "nothing was refused" is the most expensive answer in the panel, because it
  looks like proof that nobody was blocked.
- **`checkOrigin` is the point of the page.** A whole application URL in, the origin it
  reduces to shown before anything is offered, then one of four verdicts: allowed, blocked
  and addable, refusable by a rule this list holds, or a URL with no origin at all such as
  `myapp://callback`. Watching the path and the query fall away is most of what it teaches,
  so the reduction is drawn as `asked → origin` rather than silently applied.
- **The empty state names who is affected.** "No browser can complete a sign-in" was
  broader than the condition: a server calling the API sends no `Origin`, and localhost is
  allowed by the deployment while it runs in development. Say browser origins you deploy to.
- **A suggestion is one row, one source, one grant.** `ORIGIN_SOURCE_FROM` names the screen
  it came from rather than the protocol's word for it, the URL it was read off is not
  repeated, and the section says what allowing one grants — allowing is still an ordinary
  write, and nothing on the screen it came from changes (ADR-0006).

## Working on the sending domains screen

`/email/domains` follows `notes/email-domains.md`. The answer first, the list under it, the
selected domain's setup under that, and delivery last.

- **Verification and sending are two states and never one badge.** `verificationState` says
  where the DNS stands and `sendingState` says whether the From line is on it, with "Ready"
  between them for a verified domain nobody has selected. A provider will call an identity
  verified while the bounce route is missing, and a customer who saw one badge would believe
  their mail already carries their own name.
- **Change sender is beside the From line and nowhere else.** Verifying a domain must never
  move the sender, which is an acceptance check in the note; `SendingDomainSenderDialog` is
  the only thing that writes `inUse`, it lists every domain including the ones that cannot
  send with the reason, and it repeats the monthly charge at the point of choosing.
- **The answer is one line and three facts.** The From line leads at `text-base` mono with
  Change sender beside it, and the strip under it says where a rejection goes, whose
  reputation carries the mail and what a month costs on either domain. Everything a reader
  cannot act on from here is folded into the card at the foot; the two prose rows that used
  to sit under the From line pushed the list below the fold.
- **The setup is a dialog, and it was a block.** `SendingDomainRecordsDialog` opens over the
  list from a row's own control, capped from `lg` up and a full-height sheet below it; the
  note asked for a block under the list, and built, it pushed delivery off the fold and left
  a reader scrolling back up to change which domain they were reading. `SendingDomainSetup`
  is its body and holds one layout for both shapes: `flex-none` ends, a scrolling middle.
  Nothing opens it on arrival. `Check records` is the action until every required record
  resolves and `Send from this` is the action after; they are never both primary.
- **The domain list and the DNS records are both `RecordTable`.** One set of track widths per
  table, and the stacked arrangement below 900px comes from `data-label` rather than from a
  second grid the page and the row kept in step by hand. A cell that sets `flex` must set
  `flex-col` with it, or the `::before` the label is drawn with becomes a flex item and lands
  beside the value instead of above it.
- **The records are one table, not a group per kind.** Four headings and four paragraphs over
  five records made the setup three screens long. The kind, whether it is required and what
  the last check found are columns; the paragraph is behind an info glyph on the row, and the
  status detail is drawn only for a record that was looked for and missed.
- **Relative names are a control, not a caveat per row.** Most DNS consoles append the zone,
  and a fully qualified name pasted into one of those is a record that exists, is never found
  and is explained nowhere. `recordName` answers either form off `relativeHost` (`@` for the
  apex), a Full/Relative `SegmentedControl` picks one, and the column, its copy button and the
  sentence under the heading all follow it. Full is the default, because a console that does
  not append the zone refuses a relative name outright and that failure is the visible one.
- **Nothing in the record table truncates.** The value is the thing being compared against a
  console, so `CopyField` takes `wrap` here and the name and value break rather than clip.
  Same reason the row's own subtitle wraps: at 390px the primary cell is half the width.
- **The foot names the records outstanding, not their DNS types.** Three of the five are
  CNAMEs, so "waiting on CNAME" is a word a reader counts two answers for; `waitingOn` dedupes
  the kind labels the table itself uses.
- **Delivery says what it measured.** Sends are ours to count; delivered, bounced and
  complained are provider events, and that pipeline is unbuilt, so `deliveryFigures` answers
  null and each tile names what it would have counted. There are no reputation meters: a bar
  drawn over a fixture is the most confident thing on the page. The thresholds remain as
  reference with their provenance, and the bounce rule in the folded card agrees with the
  blocked addresses screen rather than promising a suppression that nothing writes.

## Working on the blocked addresses screen

`/email/suppressions` follows `notes/email-suppressions.md`. It is a diagnosis screen and
not a list: the operator arrives with one address from a support ticket and leaves knowing
whether mail to it can resume. The drawer, the breadcrumb and the title all say **Blocked
addresses**; suppression is the word for the records, not for the screen.

- **The list cannot be read, only asked.** `suppressions.target_hash` is a digest and no
  table holds the address, so the lookup hashes in the browser and sends sixty-four hex
  characters. `hashAddress` has to agree with `hashToken` in `@idenzy/crypto` exactly, and a
  test pins it to known digests. The digest is shown back because it is the proof of what
  left the machine, and it is the only string on the answer worth copying: the address is
  never put in the URL, in a log or on the clipboard.
- **The lookup sits on the page, not in a card.** A frame around the one control makes it a
  section among sections. Under it, the records are a heading that states the finding over a
  framed `RecordTable`, which is the sending-domains list one drawer item away: this is a
  handful of rows about one subject, not the project-wide list surface, so the reason tabs
  are the table's own and there is no pager or column menu over four columns. The users and
  sessions shape stays where a reader is working through hundreds of rows.
- **Three verdicts, and the third is why the lookup has its own type.** `LookupAnswer`
  carries what was asked, the digest, what was compared and when. A browser that cannot hash
  and a list that has not been read both answer `unavailable`, never "not blocked": an
  unread list is not an empty one.
- **"Not blocked" is only as good as the recorder behind it.** Nothing writes a row yet, so
  that verdict is drawn neutral and worded as unknown rather than green and worded as
  deliverable. `DELIVERY_CAPABILITIES` is the two halves, and `deliveryStatus` is the badge
  beside the title. Its label is two words because `PageHeader` truncates one line and a
  longer badge eats the title's own end at 390px.
- **`nextStepFor` is keyed by reason, not by verdict.** A hard bounce is repaired by
  correcting an address and a complaint by asking its owner, so one "release it" under every
  block would be the wrong advice five times out of six. The steps are written to be pasted
  into a ticket.
- **Release is conditional, and `releaseDecision` is where that lives.** A channel this
  screen does not own is refused here rather than released quietly, which is what makes the
  acceptance check visible: an email release leaves the SMS block on the same address
  standing, and the result and the dialog both say so. A provider-reported block asks for a
  typed reason instead of an acknowledgement tick, because a box records that somebody
  clicked and a sentence records why.
- **Releasing deletes the row and keeps a `ReleaseRecord`.** The decision outlives the block,
  which is the half of "do not erase the audit history" the panel can hold.
- **The successful release is its own state**, saying what was not done as well as what was:
  nothing is sent to check. It offers Ask again and Check another address rather than leaving
  the reader on a verdict that is no longer true.
- **Blocking an address by hand is not offered**, and the capability list says so. An
  operator hunting for an add button that is missing reads it as a bug rather than a gap.

## Working on the email template screens

`/email/templates` follows `notes/email-templates.md`, and it is two routes rather than
one: the catalogue at `index.vue`, and a workspace at `[type].vue` with the language in
`?lang`. The editor was a dialog and the note's first two findings are both about that.

- **It is a page because a modal is where unsaved work goes to be lost.** The workspace
  holds language management, three bodies, a preview, validation and reversion, and the
  old dialog reloaded its draft on every language change and dismissed on Escape without
  asking. The URL is durable so a reader can be sent one, and the language is a query
  parameter, replaced and not pushed: moving between languages is not navigation to step
  back through.
- **Drafts live in the store, keyed by project, message and language.** That is what makes
  them survive a language switch, a walk back to the catalogue and a return, and it is
  what lets the catalogue mark a message as holding unpublished copy. They are never
  written to browser storage: a draft is a customer's unpublished copy and a dashboard is
  opened on shared machines. The leave guard, the `beforeunload` handler and the
  catalogue's Unpublished drafts figure all read the same map.
- **Publish writes every language with unsaved copy, and is named after what it does.** A
  button that saved only the language on screen would leave the other two unpublished and
  say nothing, which is the same silent loss in a different place. `problems` therefore
  validates every dirty language, and a fault in one that is not on screen is a page-level
  strip with the way to it, because the refusal would otherwise have no visible cause.
- **Published is not sending, and both screens say which.** A body is compiled off the
  request path and the renderer reads an uncompiled row as absent, so `statusOf` answers
  `compiling` rather than `active` through that window and `localeStatusOf` marks the
  language. An operator told their new copy is theirs while our built-in is still going
  out has no other way to find out.
- **Revert shows the copy that would take over, and it is rarely the built-in.** A project
  holding `en` and `tr` that reverts `tr` sends its own English, because the project's
  whole fallback chain is tried before any copy of ours. `EmailRevertDialog` renders that
  answer; naming the wrong replacement is worse than naming none.
- **The catalogue's subject column is rendered, not source.** What is being checked at a
  glance is what lands in an inbox, so sample values are substituted and the template is a
  hover away. Its filter says Custom, Built-in and Unavailable: "Yours" and "Copy in use"
  both had to be translated by the reader before they meant anything.

### The editor

`CodeEditor.vue` is CodeMirror 6 and serves all three fields, the subject included.

- **The subject is the reason it is one component.** A subject typed in a `v-text-field`
  is the one field where a mistyped `{{ user.mail }}` is not marked, not completed and not
  explained, and it is the field most often typed from memory. `inline` is a shape, not a
  different editor: single line, no gutter, and pasted newlines folded to spaces rather
  than refused, because a paste that silently did nothing is the worse failure.
- **CodeMirror and not Monaco.** Monaco loads its language services from separate worker
  URLs and this panel is statically generated with no server and no third-party origin
  (PROJECT.md 10.3), so they have nowhere to come from; it is also unusable on a touch
  screen and the note specifies a mobile arrangement. The chunk is 191 KB gzipped and sits
  behind the route's own dynamic import, so no other screen pays for it.
- **The marks, the completion and the lint all read `scanPlaceholders`**, which is the
  validator's own reading of the grammar. Two readings would agree most of the time, and
  the field would go red with nothing under the cursor marked the rest of it.
- **Three marks, because a braced run fails in three ways.** A name in scope substitutes; a
  name out of scope throws and the mail is never sent; something that is not a placeholder
  at all is delivered to the reader exactly as typed. The last is the failure nobody
  notices until a customer forwards the mail back, which is why it is marked at all.
- **Tooltips are mounted on `.v-application`, not in the editor and not on `body`.** Every
  editor here sits in a card that clips its overflow, so a completion list left inside is
  cut off at the card's edge and the half that goes is the explanation. The application
  root rather than the body because Vuetify's theme class is on the root, and a tooltip
  above it is outside every `.v-theme--dark` rule in the panel. The rules for it are an
  unscoped block, as MetricChart's tooltip is, and **every selector carries at least two
  classes**: CodeMirror copies its generated theme classes onto the container it mounts a
  tooltip in, so its own defaults arrive as `.<generated> .cm-tooltip` and a bare class of
  ours loses however late it appears.
- **Tab is left to the browser.** `indentWithTab` traps it, and a keyboard user then cannot
  leave the field; the tidy button does the indenting better anyway.
- The colours come from `app/utils/code-theme.ts`, built from the same palette
  `app/shiki/theme.ts` gives Shiki. Two highlighters read different things (TextMate scopes
  against Lezer tags) so they cannot share a theme object; sharing the ten values under it
  is what stops a body being one set of colours in the editor and another in a code block
  beside it.

### Two things that will bite

- **`{{` in a Vue template is Vue's own interpolation.** A template literal containing it
  inside an expression is read as a mustache that never closes and the build fails with
  "Unterminated template" pointing at the line. Build the string in `<script setup>` and
  interpolate the result; `v-pre` covers the case where the braces are literal prose.
- **`EmailPreviewFrame`'s iframe is absolutely positioned, and that is a fix.** The frame is
  laid out at a real email width and scaled to fit, and a `transform` does not change an
  element's layout box: in flow, a frame a third taller than its stage grows the stage,
  which grows the frame. The pane climbs off the bottom of the page in a few frames with
  nothing in the markup to explain it.

`formatHtml` in `app/utils/html-format.ts` is the tidy behind the glyph beside HTML body.
It rewrites whitespace between tags and between attributes and nothing else, both of which
are insignificant by specification, and it repairs nothing: a formatter that closes an
unclosed tag can break a body that was rendering, and the reader pressed a button labelled
tidy. It is idempotent and there is a test that says so.

## Working on the SMS policy screen

`/sms/policy` follows `notes/sms-policy.md`. Readiness first, then the two decisions beside
the money they cost, then the ceilings, then everything nobody configures folded away.

- **Readiness is five checks over four screens, and the badge is read off all of them.**
  `smsReadiness` in `app/utils/sms-policy.ts` is pure over what the panel already holds, so
  the answer changes the moment a setting elsewhere does: the method (`/methods/otp`), the
  carrier (`/sms/providers`), the countries and the human check (here), the balance
  (`/settings/billing`). A policy that called itself ready while the vendor transport or the
  verifier was unavailable is the one thing this screen must not say.
- **The human check is the reason the screen exists.** Attestation is on by default and
  nothing on this deployment can answer one, so a project with a perfect allowlist and a
  healthy cap still sends nothing and the refusal names a token the caller could never have
  obtained. No log says "your settings are fine and the deployment is not".
- **`Set up SMS` writes one policy; there is no `Create a policy`.** The old button made the
  row with its column defaults and left the project as unable to send as before, which is a
  database step wearing a decision's clothes. `SmsSetupDialog` asks for the countries, the
  cap and the human check and writes the row once; delivery is a step that asks nothing,
  because it is settled elsewhere and a policy is still worth writing without it.
- **The cap is a draft with its own Save, and the ceilings are dialogs.** The cap is typed,
  so saving the "2" of a "20" refuses every send until the "0" lands; the other three are
  one bounded whole number each and go through `NumberDialog`. `capChange` states the before,
  the after, and the case the note asks for by name: a cap at or below the day's spend stops
  the channel until midnight UTC, and that has to be readable before the write.
- **Never draw the spend meter without a cap.** `capShare` answers 1 for a cap of nought, so
  a project with no policy drew a full red bar at nought spent, which is the opposite of the
  truth. The meter is bound to `policy`, and the line under it says why nought there is a
  refusal rather than a quiet day.
- **Reserved is shown apart from spent.** A reservation is taken before the message goes out
  and settled against what the carrier charged; an unsettled one stands rather than being
  released, because a dispatch that threw may still have put a message on the wire. The cap
  reads the whole ledger and only the settled part is a message somebody was handed.

## Working on the SMS providers screen

`/sms/providers` follows `notes/sms-providers.md`. The two arrangements, the project's own
destinations, delivery health, then the catalogue folded away.

- **Two panels, never a segmented switch.** Managed delivery and a customer's own account
  are not two settings of one thing: the estimate, the billing owner and the readiness are
  three answers that differ between them, and a toggle offers no way to compare three
  answers. Each panel states its own and carries its own action inside it.
- **Nothing reads as carrying traffic, because nothing does.** Every vendor adapter is a
  port with no implementation, so no `SmsProviderInfo` is `live`, `transportWired()`
  answers false, the store's `traffic()` returns nought rather than the fixtures, and the
  route column is `Intended route` and hidden by default. A test asserts the first two. The
  claim this screen must not make is the one nobody can check from the panel.
- **Delivery health is a figures strip, so it leads.** The note draws it under the table;
  built that way it put the one thing an operator glances at on arrival three screens down.
  Same rule as the revocation screen: figures strip, then the operational content, then
  everything else. The tiles are `UsageTile`, which draws a faint wave and `No data` in
  words rather than a chart of nothing.
- **Per segment, and the rates are examples.** The column is `Price per segment` and
  `RATE_SOURCE` says once that the figures are the published wholesale plus our margin held
  in the panel, not a live feed. "Per message" was the old column title and it contradicted
  the prose beside it.
- **`routeReadiness` answers per row, and the deployment's gap is stated once.** The
  allowlist first, because it is the project's own and free to change, then the
  registration; a blocker true of every row at once goes above the table instead. Every
  Action links to the flow that settles it, never to a general guide.
- **Connecting an account is verify then activate.** `Verify account` presents the pair to
  the vendor; only a success turns the footer into `Use this account`, and editing either
  half makes the answer stale. A refusal keeps the vendor and the key, clears the secret,
  and switches nothing. The clear is the component's own, so it must not mark the answer
  stale and take the refusal off the screen with it.
- **A changed column set needs a new `useLocalStorage` key.** `reconcileColumnState` keeps
  what a reader remembered, so reusing the old key brought the illustrative route column
  back for anybody who had visited before.

## Working on the API keys screen

`/keys` follows `notes/keys.md`: the type tabs under the title, the keys of that type, any
rotation somebody started, then the reference folded away. `app/utils/keys.ts` holds every
rule; the page arranges it.

- **A rotation is started, never inferred.** `rotationsOf` returns only a live replacement whose
  `replaces` names a live key. Two live keys of one kind are two keys: the newer is as likely to
  be an undeployed replacement as the key traffic moved to, and the old screen ranked them by
  last use and recommended revoking the wrong one. Rotate is on a key's menu and nowhere else,
  and `replaces` is a proposed `api_keys` column, like a purpose.
- **An observation is not a census.** `last_used_at` says when a key was last presented, not who
  else holds it, so the words are "No observed use in 24 hours" with `OBSERVATION_WINDOW_HOURS`
  and `OBSERVATION_LIMIT` beside them, and nothing says "safe". The revoke dialog asks about
  consumers every time, a key silent for days included: that is the weekly job.
- **A replacement nobody has presented is never finished.** `rotationHeadline` answers "Deploy
  the replacement" until the replacement is observed, however old it is. Review revocation is
  offered throughout and becomes the primary action only once the replacement is observed and
  the old key has not been since.
- **Purpose is said to be proposed, once, above the list.** The row has no column for a name,
  and a label kept only in the panel would disagree with every other client of the API. Created
  by is real: it is the actor on the audit trail's `key.created` entry, and null past retention
  reads "Not recorded".
- **Compromise is the other procedure.** Revoke now on the menu, and Revoke now instead in the
  rotate dialog, open the revoke dialog in its `compromised` form, which asks about the breakage
  rather than the consumers: revoke first, deploy after.
- **The reveal has an honest exit.** Persistent, a full-height sheet below `lg`, the value on one
  line that scrolls sideways with a labelled Copy beside it, and Close without copying, which
  says the key stays live with nobody holding it. No "I have stored this key" tick
  (notes/dialogs.md).
- **Browser configuration never holds a secret key.** `PLACEMENTS` spells the names the starter
  templates write: the browser list only under a public prefix, the server list never under
  one, and tests hold both. Only a key's detail shows them, and it copies a variable name,
  never a prefix with an ellipsis. The reveal shows the value alone.
- **All keys is the first tab and the page's own address.** It lists the live keys of both
  kinds, with every rotation under it. A live secret key wears `chart-6` there, read off
  `--v-theme-chart-6` so it follows the theme, which sets the two kinds apart in a mixed list;
  a kind tab, where every row is one kind, leaves it plain.
- **Show revoked adds the revoked keys to All keys and the kind tabs.** Off by default and
  remembered per viewer in `useLocalStorage`, because it is how somebody likes to read the list
  rather than a fact about the project. `tabCounts` takes the same flag, so a tab's count is the
  rows under it; the Revoked tab ignores it, and the checkbox is not offered there.

## Working on the webhooks screen

`/webhooks` follows `notes/webhooks.md`: the endpoints with their state and health, the one
selected with Edit and Send test event, its attempts by outcome over a period, its signing
settings, then the verifier and the guarantees folded away. `app/utils/webhooks.ts` holds the
rules; the selected endpoint is `?endpoint=`, replaced rather than pushed.

- **Nothing delivers, and the page says so first.** No worker consumes the webhook topic and
  `webhooks.secret_hash` is a digest, which can check a secret and cannot sign with one.
  `WEBHOOK_DELIVERY.running` is false: `deliveriesFor` answers nothing rather than the sample
  attempts, health reads "Not measured", and Send test event and Retry delivery are shown
  disabled with the reason beside them. An attempt on this screen is a claim that we called
  somebody's URL, which the note's acceptance check forbids. Flip the flag to see the
  workspace populated.
- **The verifier sample is executed by the tests.** `VERIFY_BODY` is plain JavaScript, and
  `webhooks.test.ts` runs that exact text against HMACs from `node:crypto`: a rotation's second
  signature, a fetch `Headers`, and malformed headers that must answer false without throwing.
  It parses the `sha256=` scheme and checks the length before `timingSafeEqual`, the two things
  the old sample got wrong.
- **Retry and test are different acts, and each says so where it is offered.**
  `RETRY_SEMANTICS` is the same delivery again under the same delivery ID; `TEST_SEMANTICS` is a
  new delivery of `webhook.test`. Retry sits at the foot of the attempt detail, under the ID.
- **Why an endpoint is off is on its row.** `EndpointDisabled` separates a person pausing it,
  named, from the switch-off after `FAILURES_BEFORE_DISABLED`. The remove dialog offers Pause as
  the safer choice; neither queues anything, and resuming replays nothing.
- **Rotation is in signing settings and names its deadline** in `WebhookRotateDialog`, before
  anything changes. The secret dialog repeats it, has no "I stored it" tick, and offers Close
  without copying. Where the secret is kept is stated as unsettled rather than promised.
- **The event groups are an accordion.** `WebhookEventGroups` opens the first group, allows any
  number open, gives each group a line of its own and a checkbox that takes or leaves it, mixed
  while partial; a folded group still counts what is chosen in it. Asked for by name: the flat
  list of thirteen read as too much.
- **Observed delivery is a figures strip, and while nothing runs it reads No data.**
  `deliveryFigures` counts seven days of deliveries by outcome. With none, every `UsageTile`
  draws its faint wave and No data, the answer the allowed origins screen gives, rather than
  four zeros that read as a clean record.

## Working on the hooks screen

`/hooks` follows `notes/hooks.md`: a one-line webhook decision under the title, the figures,
the five hook points with readiness, deadline and failure rate, then signing and failure folded
away. Configure opens a hook's own configuration, which owns its endpoint, deadline, contract,
check and Enable. `app/utils/hooks.ts` holds the rules.

- **A hook's configuration is a dialog, not a block under the list.** Asked for by name: the
  note draws it inline, and built that way it read as a second section below the fold. It is
  capped from `lg` up and a full-height sheet below, and `?hook=` names it, replaced rather than
  pushed, so a link opens it. The edits it offers stack over it instead of closing it, because
  the reader comes back to it to validate and enable; the security centre closes its detail
  first only because its dismiss is destructive.
- **Nothing calls a hook, so nothing can be enabled.** `FlowHooks` has one method, bound to
  `NullFlowHooks`, which answers yes without calling anybody, and the other four hooks have no
  call point at all. `HOOK_CALLS.running` is false: `store.enable` refuses, `statsFor` answers
  null so the figures read No data, and every fixture that would read as an enforced gate stays
  behind the flag. A gate that exists only in local state is the note's first P1.
- **Enable waits on a check of the configuration as it is now.** `checkHook` runs the address,
  the secret and the budget here, then a signed call and a wrongly signed one where a call can
  be made. `isCheckCurrent` ties a check to the URL and deadline it ran against, so a change
  reads as not validated. `enableBlocker` puts a failed check before the missing caller, because
  only one of the two is the reader's to fix. The call half says "Not run" today, never passed.
- **An unreachable endpoint saves, then fails its check.** `unreachableReason` knows the
  special-use names (`.invalid`, `.test`, `.internal` and the rest) and the private IPv4 ranges.
  The form cannot know a tunnel is about to be set up, so it saves; the check is where it fails,
  before anything is enabled, which is the note's first acceptance check.
- **A new URL on an enabled hook is validated before it replaces the live one.**
  `replacesLiveEndpoint` turns the dialog's action into Validate and save, and a failure leaves
  the current URL called and says so. Turning the gate off to change an address would drop a
  policy for the length of a redeploy.
- **A hook has a secret of its own, one per project.** The old copy said hooks were signed with
  "your webhook secret", which named nothing: webhook secrets are per endpoint and a project can
  hold none or several. The first endpoint makes the hook secret and `HookSecretDialog` shows it
  once; rotation is in the Signing fold and names the overlap and the fail-closed consequence.
  The headers and the scheme are the webhooks' own, re-exported so the two cannot drift.
- **The budget is per path.** `addedTo` counts before-sign-in and customize-claims on a sign-in,
  adds before-sign-up on a sign-up, and never counts the two that send. The old header summed
  all three as one sign-in figure.
- **Turning off a gate names what stops being checked.** `HookRemoveDialog` asks an enabled gate
  for an acknowledgement stating the sign-ins or sign-ups it will no longer check, with Keep gate
  beside the action. A hook that is not enabled enforces nothing and goes without one.

## Working on the security centre

`/security` follows `notes/security.md`. Two tabs: a queue somebody works down, and the
detectors somebody comes to once.

- **Every count on the screen comes from the rows on the screen.** The strip said twenty-two
  open over a list of ten, because the figures were the project's totals and the list was the
  window. `scope` is computed from `filtered`, and the strip says which view and which period
  it is counting.
- **Observed, configured and enforced are three different facts.** `RESPONSE_ENFORCEMENT`
  says what each response actually does today: only `record` is carried out, because nothing
  raises a challenge from a detector and nothing sends a notice from one. `enforcedResponse`
  degrades the rest, `detectorStatuses` reports all three, and a row whose configured and
  enforced disagree says so with a link to where the missing half is built. Never let a
  setting be read as the behaviour.
- **The one code sample here is copied by developers, so it is the protocol's.** The page
  showed `status: "challenge"` with a `reason` field; the union is `authenticated` /
  `mfa_required` and the challenge has no reason (ADR-0010). Mirrored into
  `utils/security.ts` with the source named — the panel takes no dependency on
  `@idenzy/protocol` until the management client does — and pinned by a test.
- **"Always" is only for what is running.** `DEPLOYMENT_DEFENCES` marks Cloud Armor
  `unavailable` because it is designed and not provisioned; the application rate limits, the
  constant-time answer and refresh-reuse revocation are `enforced`. The same rule as the SMS
  vendor states: an unfalsifiable claim is one that is only tested during the incident.
- **The queue is `DataTable` and the detail is a dialog.** The note draws a 5/7 split;
  five columns left nowhere for the account a row is about, which is the column somebody
  traces a signal by. The table gets the page and `SignalDetailDialog` opens over it: the
  signal cell is the way in, as a person's name is on the users list, and the ellipsis keeps
  the less frequent actions. Opening the dismiss dialog closes the detail first — two
  overlays deep is a reader who cannot tell which Cancel they are pressing.
- **Inside the detail: evidence, the innocent explanation at the same size, the person and
  their sessions, the decision history, then the actions.** Acknowledge is neutral and flat,
  Dismiss is text, and signing out is the only destructive one and sits apart from both.

## Working on the audit log

`/audit` follows `notes/audit.md`. Search and every filter above the record, the trail in
eight columns, who and what is excluded in four.

- **What the view leaves out is a chip, not a rail switch.** The end-user activity starts
  set aside because on a live project it is nine rows in ten, but the chip carries the count
  and its own way off, and the period control ends at `All time` rather than `All`: `All`
  over a view that excludes most of the trail is the one word this screen must not use.
- **`ACTION_ACTORS` says who can have done what, and the fixtures obey it.** A service
  credential has no browser and no password, so it cannot sign in to the dashboard or accept
  an invitation; the trail said otherwise and an audit story that contradicts the role model
  undermines the thing it is evidence for. `weightedFor` in the store draws from the actions
  that actor could author, and tests pin the constrained pairs.
- **The flag is `Sensitive` and it has a written rule.** `SENSITIVE_CRITERION` names what
  earns it and ends by saying an unmarked entry is not a less important one. "Worth reading"
  was an editorial judgement about the rest of the trail.
- **Say what the guarantee is and stop there.** The runtime role holds INSERT and SELECT and
  the chain makes an alteration detectable; neither means nobody with direct access to
  storage can change a row. `INTEGRITY_CLAIMS` is those three sentences, and the middle one
  says detectable is not the same as impossible.
- **A detail reads: what moved, the request, then the chain.** `from`/`to` in the metadata
  become a before and an after at the top; `requestId` is a field on `AuditEvent` rather than
  a line in the metadata blob, so it is a column, searchable, and in the CSV. Hashes last.
- **Metadata is Shiki through `CodeBlock`.** `json` is already in `shiki.bundledLangs`, the
  block renders plain until the highlighter loads rather than suspending the row, and an
  entry with no metadata draws nothing rather than an empty pair of braces.
- **Export states its scope before it downloads.** `auditScope` builds the lines and
  `AuditExportDialog` shows them: project, period, count, every filter, and whether the
  end-user activity is in the file. Empty is an answer about the filters, not a failure.

## Working on the data requests screen

`/data-requests` follows `notes/data-requests.md`: the counters that filter the queue, the
queue in deadline order, then a request opened over it with its receipt, its verification,
the work and the answer. `app/utils/data-requests.ts` holds every rule; the page arranges
them.

- **The deadline runs from receipt, on the calendar, under a named rule.** `dueFrom` adds
  the rule's period to `receivedAt` and ends on that day, so the 31st of August is due on
  the 30th of September, and a request typed in five days late is due on the same day as
  one typed in on arrival. The old screen added thirty days to the moment of logging and
  called a fixed interval statutory, which are the note's first two P1s. `RULE_INFO` holds
  GDPR and CCPA, `CALENDAR_NOTE` says the panel never rounds a date later than the rule's
  own, and which rule applies is stated as the privacy owner's decision rather than ours.
- **A request closes on evidence, never on a badge.** `workDone` reads a finished export, an
  erasure record, a correction, or a check that found no account; `canClose` wants that and
  a recorded answer, and the store refuses the write without them. `nextActionOf` is the one
  primary action a request offers and `actionBlocker` says why it cannot be taken where it
  cannot, which is what keeps the footer to a single valid step.
- **Refusing is its own act with its own record.** `refusalIssues` demands the grounds, the
  reasoning in writing, the day the person was told, and an acknowledgement that the message
  said what the rule requires (`RULE_INFO[rule].refusalNotice`). Mark completed and a bare
  Refuse were the third P1.
- **Nothing builds an export, and the page says so first.** `EXPORT_JOBS.running` is false:
  `prepareExport` refuses, the footer shows the reason beside a disabled action, and the
  fixtures carry no export runs, because an export drawn here is a claim that somebody's
  data was assembled. `OVERDUE_ALERTS.running` is false for the same reason the old copy was
  wrong: todo.md still lists due-date alerting as unbuilt, so the screen says an overdue
  request shows in this queue and nowhere else. Flip either flag to see that half populated.
- **An erasure runs the users store's own.** One action in one place, so an erasure answered
  from a request and Delete on the users screen cannot come to differ. The tombstone is the
  evidence; the request keeps the account id as proof and clears `claimedIdentity` with the
  rest, because the identity they gave when they asked is personal data too.
- **`rejected` is the protocol's word and Refused is the reader's.** The statuses mirror
  `DsrStatus` in `@idenzy/protocol/enums/compliance`, like the security screen's sample. The
  old list said `refused`, which the API never answers with, and a test pins the four.
- **An extension is reviewed, and once.** `extensionBlocker` answers all three rules: one per
  request, told to the person inside the first period, and agreed by an owner or admin other
  than the actor. A project with nobody else to ask says so rather than offering a control
  that fails.
- **The subject is searched and confirmed, never typed exactly.** `DataRequestSubjectSearch`
  shows the account whole before it is used, and a request the search cannot place is
  recorded as the person described themselves, then matched when it is verified. The old
  form needed an exact address and dropped everything else.
- **The counters are the view control.** Overdue, Due within 7 days, Open and Closed are
  toggles over the same queue, so the figure an operator arrives for is also the way into the
  rows behind it, and the heading states the finding over the rows actually shown.
- The view, the two menus and the open request are in the query, replaced rather than pushed;
  the search term is not, because an address in a URL is personal data in a browser history.

## Working on the usage screen

`/usage` follows `notes/usage.md`: the billing period beside the title, actual charges beside
the month-end projection and the hour the figures run to, active users against the allowance,
the activity chart, then the line items with who bills each. Export and the meter definitions
sit under the breakdown. `app/utils/usage.ts` holds every rule; the page only arranges it.

- **Money is cents from the first multiplication, and each line is rounded once.** `billFor`
  rounds every line to the cent, halves up, and totals the rounded lines. Billing's draw-down
  reads that `totalCents`, and the billing store raises each invoice from a closed period's
  `billFor`, so the three screens are one figure. They were a cent apart when one rounded the
  sum and the other the lines.
- **A projection is per meter, and says what it assumes.** `projectTotals` continues each meter
  at its last seven complete days' average and `projectBill` prices the result. Dividing the
  dollars by the month's progress projected a domain fee twice over and nothing for active
  users still under the allowance. Every projected figure reads "At the current average rate",
  and `PROJECTION_BASIS` says it overstates active users, who slow as a month goes on.
- **There is one definition of an active user.** `MAU_DEFINITION` is PROJECT.md's first-day-free
  rule written as one rule, any authentication on a day other than the account's first, and
  `MAU_EXAMPLES` answers the note's acceptance check about the user who only signs in on
  sign-up day. `MAU_SUMMARY` is its two-sentence form. Write it nowhere else.
- **Four kinds of nothing.** `LineState` separates the allowance, no usage, a vendor that bills
  the customer directly, and a meter that does not exist. A vendor line says "Charged by Idenzy.
  Twilio bills you separately." and names the vendor as its billing owner; logging reads "Not
  metered" and carries no charge rather than $0.00.
- **The chart compares with the same dates a month before, not the window before.** Active
  users are a level that starts again on the 1st, so the seven days before the 7th straddle
  the reset. `usageWindows` anchors at the hour the figures run to, or at a closed month's end.
- **The period is a query and a menu, never a dialog.** `?period=2026-08`, replaced rather than
  pushed, and the open month carries no query, so the month survives a trip to Billing and back.
- **Unknown is never drawn as a zero.** A failed read keeps the last figures, says when they are
  from and offers Retry; no figures at all is dashes and no total.

## Working on the billing screen

`/billing` follows `notes/settings-billing.md` and is top-level rather than a settings tab:
the wallet is the organisation's rather than one project's, and understanding a bill is its
own task rather than a preference. `app/utils/billing.ts` holds every rule.

It is a shell and four tabs, built the way Settings is: `pages/billing.vue` holds the rail
(`SettingsTabs`, reused as it stands) and renders `<NuxtPage />`, and the tabs are Overview
(`billing/index.vue`), Wallet (`billing/wallet.vue`), Payment methods (`billing/methods.vue`)
and Invoices (`billing/invoices.vue`). `NAV_BILLING` is a group with those four children so
the breadcrumb reads "Billing / Invoices" and a link to one tab lands on it; the drawer
still shows one item, pointed at `/billing`.

- **`useBillingScreen` is the four tabs' one set of figures.** The composable reads the
  stores, sums this month the way the usage screen sums, works out last month at the same
  point, names the repair and holds the write helpers. Every ref in it is made per call, so
  a dialog's busy flag or the last top-up refusal never follows the reader to the next tab.
  A tab arranges; it derives nothing of its own beyond its columns and its dialog flags.
- **No cards.** The one page this replaced stacked six `LayerCard`s and the reader scrolled
  past everything they did not come for. Each tab now opens with `PageHeader`, says once in
  an `InfoNote` that nothing can charge, and parts its subjects with `PageSection` rules; a
  list is a framed `RecordTable`, the invoices are a `DataTable` in a bordered `v-card`, and
  what is true rather than adjustable is a `FactGrid`.
- **The figures are a fact band, not a tile row.** The overview opens with four facts
  (balance, charged this month, projected month-end, and the payment state) and the wallet
  with four (balance, purchased, promotional, expiring within the fortnight), each with its
  sentence behind the glyph on its label and one short line under the value. The movement
  against last month is that line, written by `trendOf`, rather than a coloured arrow: a
  rise in spend is not bad news the way a rise in failures is. The fourth overview fact is
  the runway while nothing is wrong and the amount owed the moment something is, because the
  two are never both worth reading.
- **A past-due invoice is `BillingPastDue`, a tint and not a solid.** It was drawn solid red
  first and read as shouting at somebody who had already seen the figure and the dot, so it
  takes the step `InfoNote` takes for a warning: a wash, a hairline ring, the error colour on
  the glyph and the action only. One component on the overview and the invoices tab, so the
  two never say different things about the same invoice.
- **`BillingAddCredit` is the one funding control**, on the overview beside the balance (as
  the note asks) and on the wallet. One component rather than the same disabled button and
  tooltip twice, so the reason text cannot drift.

- **Nothing charges anything, and the page says so first.** `PAYMENTS.running` is false:
  Stripe is not integrated, `orgs.billing_customer_id` is the only billing column in the
  schema, `management-api` registers a health controller and nothing else, and no worker
  consumes a payment webhook. `store.topUp` returns the refusal and writes nothing, Add credit
  is shown disabled with the reason, and the credit in the fixture is granted rather than
  bought. A local balance that grew because somebody pressed a button is the one thing this
  screen must never do (notes/settings-billing.md P1).
- **`CheckoutState` is named now so the dialog is built against it** rather than against a
  boolean. A card payment can be in flight, need the cardholder at their bank, be abandoned on
  the provider's page, or fail after being accepted, and a dialog that only knew "busy" would
  report the same thing for all four. The dialog stays open on a refusal with the amount still
  typed, because closing cleanly is the whole of the evidence a reader gets.
- **The balance is derived from credit grants, never stored.** A grant is `purchased` or
  `promotional`, promotional credit expires, and expired credit is worth nothing, so a stored
  total would keep counting it. `walletOf` splits it the way the reader asks about it.
- **`drawOrder` spends what would otherwise be lost first**: promotional before purchased, and
  inside each kind the soonest to expire first. The other way round, a promotional grant
  expires unused while purchased credit pays the bill, and the customer is right to call that a
  charge they should not have had.
- **Exactly one payment method is the default.** It is the one anything automatic charges, so
  `withDefaultMethod` moves it in a single change (two defaults is an argument about which one
  an unattended charge used, none is a rule that silently cannot fire), `withoutMethod`
  promotes a successor, and `methodRemovalIssue` refuses the last method while automatic
  top-up is armed. An automatic rule names its own method: "whichever is the default" changes
  what it charges when somebody else changes the default.
- **An invoice is the organisation's, and its total is the sum of each project's own rounded
  total for that month.** Never recomputed from combined meters: each project's lines are
  rounded once by `billFor`, and summing those is what keeps this screen, Usage and the
  invoice one figure by construction.
- **A past-due invoice replaces the runway rather than sitting beside it.** `paymentRepair`
  names the repair; an estimate of how long the credit lasts, printed over a bill nobody paid,
  is the optimistic reading the note asks to remove.
- **`autoTopUpEffect` says whether saving the rule charges immediately.** A threshold above the
  balance already held is a charge and not a safety net, and that has to be readable before the
  write.
- **The app bar carries no Top up button.** A funding action there competes with this screen's
  own, and at 390px it and the balance crowded out the one thing the bar has to keep, which is
  which project is being read. The balance is a link to `/billing` and desktop only.

## Working on the settings screens

`/settings` is one page and three tabs: General (`index.vue`), Members and Account. The
parent route `settings.vue` holds the rail and renders `<NuxtPage />`, so each tab is a real
URL, `/settings/members` keeps the two links that already pointed at it, and the breadcrumb
can say "Settings / Members" because `NAV_SETTINGS` still names each child. `/account`
redirects to `/settings/account`.

- **The rail is navigation, not a tablist.** `SettingsTabs` is a `nav` of `NuxtLink`s marked
  with `aria-current`, and it must stay that way: `role="tab"` promises a panel that swaps in
  place, so announcing a route change as a tab leaves a screen-reader user waiting for
  content that has already replaced the page. It matches on `router-link-exact-active`, never
  `router-link-active`, or `/settings` lights while `/settings/members` is open. Vertical from
  `lg` and a scrolling strip below, because the blueprint asks for stacking rather than a
  120px column that truncates every label.
- **The ownership model is user, then organisation, then projects.** Every person belongs to
  an organisation, personal with one member and a team with more, and seats are free either
  way so neither is a tier (`orgKindOf` counts the members rather than storing a kind, which
  is what stops the label and the list disagreeing). An organisation holds as many projects as
  the customer has applications. So **the team and the wallet are the organisation's and the
  sign-in rules and the meters are the project's**: `members` and `billing` are keyed by org
  id, every other store by project id. That is what `orgs.billing_customer_id` and
  `projects.org_id` already say, and it is the first finding on all three settings notes.
- **Each rail row carries its scope** ("This project", "Organisation", "You"), because the
  three screens sit next to each other and own different things. A removal that said "this
  project" on an organisation holding three would take access the reader was not told about.
- **`ProjectFacts` carries no `orgName`.** The organisation comes from the project store,
  which the drawer and breadcrumb read, so there is one name rather than two to drift.
- **Retention is the General tab's one draft.** Five ages are one decision about what the
  purge worker sweeps, so they collect in a draft with `Cancel changes` and `Save changes` at
  the section's foot; the name goes through a dialog and nothing else on the page is editable.
  The audit subject is not in the draft at all, because it follows the tier and an override
  would be a number the worker ignores.
- **The members screen's second-factor requirement is recorded and not enforced.**
  `MFA_ENFORCED` is false: there is no enrolment step inside the dashboard's own sign-in, so
  `MemberMfaDialog` says the requirement is recorded and a member without a factor still gets
  in. The note's P1 is that the transition has to exist before the promise does.
- **An address change moves nothing until both sides confirm.** `startEmailChange` writes an
  `EmailChange` beside the profile and the live address keeps working; patching `email` with
  `emailVerified: false` reads as a move that happened, on an account whose owner can still
  only reach the old mailbox. `ACCOUNT_WRITES.running` is false and the tab says so once at
  the top, because nothing on it reaches a server yet.
- **The danger zone is last and in its own frame**, on both General and Account, and never
  beside Rename. The resource counts live in the delete dialog, which is where the decision
  is actually made.

