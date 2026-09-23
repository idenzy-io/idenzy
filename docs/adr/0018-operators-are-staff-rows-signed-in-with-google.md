# ADR-0018: Operators are `staff` rows, signed in with Google through our own product

- Status: accepted
- Date: 2026-09-23

## Context

Invoicing (ADR-0019) is chosen per organisation by a person at Idenzy, which needed something
the repository did not have: an identity for Idenzy's own staff. Until now there was none. The
dashboard's users are customers, `apps/admin` was an empty shell, and every organisation-level
change was made by a customer, about themselves.

The ask was specific: a `staff` table with a role for each member of staff; staff limited to
`@idenzy.io` addresses; staff added by CLI or directly in the database; Google sign-in only, with
no passwords.

Two facts made the obvious version unsafe.

- **An email address is not a Workspace account.** Anyone can create a personal Google account on
  an address they can receive mail at. Google verifies it, and `email_verified` is true. Checking
  that the email ends in `@idenzy.io` therefore admits an outsider who can read mail sent to one
  such address, such as a forwarding rule or a former employee's alias. Only the ID token's `hd`
  claim says that the account belongs to the idenzy.io Workspace.
- **The access token carries neither the email nor the sign-in method.** Anything the guard
  decides from those has to be read from the server's own records, not from the token.

## Decision

### 1. `staff` is a table the application can read and never write

`staff` holds these columns: `id`, `email`, `role` (`support` < `billing` < `admin`), `active`,
`deactivated_at` and `note`.
- A check constraint holds `email` to `^[a-z0-9._%+-]+@idenzy\.io$`.
- A second check ties `deactivated_at` to `active`.
- The application role has `SELECT` only. A migration revokes `INSERT`, `UPDATE` and `DELETE`
  explicitly, and `tenancy.integration.test.ts` asserts it.

No bug in the API can therefore grant operator access, because the API's connection cannot write
the table at all.

Staff are managed with `pnpm staff add|role|deactivate|list`, which uses the owner connection, or
by SQL as the owner. A deactivated row is kept rather than deleted, so `operator_actions` never
points at nothing.

### 2. Every operator write is recorded, in the same transaction

`operator_actions` holds these columns: staff, action, organisation, detail, reason and time. It is
append-only: the application role has `SELECT` and `INSERT`, and nothing else.
- An operator write inserts its row in the transaction that makes the change, so a change without
  a record cannot commit.
- A write that changes how a customer is billed requires a reason.

### 3. Sign-in is our own product, Google only, with the hosted domain enforced

Staff sign in to a second Idenzy project, the operator console (`OPERATOR_PROJECT_ID`, seeded by
`db:seed`), whose only sign-in method is Google. We use our own sign-in rather than a separate
OAuth integration: a separate integration would be a second implementation of what the product
already does, and the first one gets tested.

`GoogleProvider` gained a generic hosted-domain setting (`oauth_providers.settings.hostedDomain`):
- it sends `hd` on the authorize URL;
- it **refuses an ID token whose `hd` claim is not that domain**, whose email is outside it, or
  whose email is not verified.

The authorize-URL parameter is only a hint to Google's account chooser. The check on the token is
the control. Customers can use the same setting.

ADR-0002 is not touched. The console's sign-in page is our own internal surface, like the
dashboard's, and it signs in through the SDK like any customer's would.

### 4. `StaffGuard` makes four checks, and each one alone stops a different mistake

The guard applies to `/v1/operator/*` through `@RequireStaff(role)`:

1. The access token belongs to the operator project. It is verified against that project's own
   audience, and read from the `Authorization` header only, never the shared cookie. This
   refuses a token from the dashboard project or from a customer's project.
2. The user has a Google identity in the operator project, read from the server's records.
3. That identity's email matches the staff pattern. This check still holds if the project is
   misconfigured without `hostedDomain`.
4. An active `staff` row exists for that email, with a role high enough for the route.

Anything else gets a 401, and the refusal is logged. An API with no operator project configured
refuses every operator route.

The console runs on its own origin (`OPERATOR_ORIGIN`, `https://console.idenzy.io` by default).
That origin is allowed on the operator surface and nowhere else. The console uses
`sessionTransport: "header"`, so its token never shares a cookie with the dashboard.

## Consequences

- There is now a record of who at Idenzy changed what about a customer's organisation. The only
  change so far is the billing mode (ADR-0019).
- Adding a member of staff is a deliberate act with database access. That is by design, and it is
  slower than a button would be.
- Signing in end to end needs a Google OAuth client for the operator project
  (`OPERATOR_GOOGLE_CLIENT_ID` and `OPERATOR_GOOGLE_CLIENT_SECRET`) and an idenzy.io Workspace
  account. Without them, the `hd` check and the guard are covered by conformance and integration
  tests: wrong `hd`, missing `hd`, unverified email, a dashboard token, an inactive row, and a
  non-idenzy.io address.
- Staff have no second factor beyond what the Workspace enforces. The Workspace's own 2-Step
  Verification policy is the control, and it lies outside this repository.
