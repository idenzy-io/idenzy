# ADR-0011: The control plane has its own tenant key

- Status: accepted
- Date: 2026-09-12

> **Superseded in part, 2026-09-21.** The control plane is gone as a plane: there was never a
> second database, only a second RLS key and a phantom TypeScript brand, and both were
> removed with the policies. What survives is the distinction this ADR was really about —
> an organisation is not a project. `org_id` is still a separate discriminator, `OrgRepository`
> is still a separate base that cannot take a `TenantContext`, and keeping the two apart
> matters more now than it did: with no policy underneath, a base that accepted either
> context would filter on whichever column it reached for.

## Context

ADR-0003 gave tenant data two independent lines of defence: a repository that cannot be constructed
without a `TenantContext`, and an RLS policy keyed on `current_setting('app.project_id')`. Every
table carrying `project_id` gets both.

The control plane was outside that from the start, and while it held three tables nobody minded.
`region_cells` is a registry of stacks, `orgs` is a name and a billing identifier, and
`staff_access_grants` is read by staff tooling. None is tenant data, none has a natural tenant key,
and `UnitOfWork.runGlobal` exists precisely so a transaction can touch them with no tenant bound.

Billing changes the shape of that. The panel's screens make the ownership explicit: the wallet, the
payment methods, the invoices, the team and its invitations all belong to an **organisation**, and
the sign-in rules and the meters belong to a **project** underneath it (`notes/settings-billing.md`,
`notes/settings-members.md`, `apps/client/app/utils/organisation.ts`). That is roughly ten new
tables keyed on `org_id`, holding card fingerprints, credit balances and issued invoices.

So the question is not whether the control plane is tenant data. It is whether an organisation is a
tenant boundary, and it plainly is. ADR-0003's own argument applies word for word one plane up:
application filtering alone "fails the day someone writes a query that forgets a `WHERE project_id
= ...`, and code review is not a reliable control against an omission". Reading another
organisation's invoices is the same class of incident as reading another project's users, and on
the money surface it is the one a customer notices first.

## Decision

Give the control plane the same two lines, keyed on its own discriminator.

**A second setting.** `app.org_id`, set by `UnitOfWork.runForOrg(context, work)` with the same
parameterized, transaction-local, first-statement `set_config` call `run` uses for `app.project_id`,
for the same three reasons spelled out in ADR-0003. The two settings are independent: a transaction
holding an org key matches nothing on a project table, and a transaction holding a project key
matches nothing on an org table.

**A second policy helper.** `orgIsolationPolicy(table)` in `schema/shared.ts`, identical in shape to
`tenantIsolationPolicy` down to the `true` argument and the `nullif(..., '')`, so a query outside an
org transaction matches nothing rather than everything.

**A second repository base.** `OrgRepository` takes an `OrgContext` and owns the `org_id` predicate.
The constraint-violation translation both bases need moved up into `AbstractRepository`, which holds
a transaction and no scope at all.

The two bases stay separate rather than becoming one base that takes either context. A single base
would have to pick a column at runtime, and the failure mode of picking wrong is exactly the
cross-tenant read the design exists to prevent.

`region_cells` and `staff_access_grants` keep neither key and stay on `runGlobal`. A cell registry
has no owner and a staff grant is about a staff member, not a customer.

## Consequences

- All organisation-scoped work happens inside a transaction, for the same reason tenant work does.
- A new org-keyed table needs the FORCE RLS and grant blocks a new tenant table needs. The `DO`
  blocks copied from `0004_nasty_catseye.sql` are dynamic and already cover it: they loop over every
  table with RLS enabled, whichever key it carries.
- `orgs` itself is keyed on its own `id` rather than an `org_id` column, so it carries a
  hand-written policy the way `projects` does.
- The isolation test suite gains an org-plane mirror of the tenant negative test: deliberately
  misuse an `OrgRepository` to read another organisation's rows, and assert zero come back.
- Two settings mean two ways to forget one. The mitigation is that forgetting either returns nothing
  rather than everything, which is the failure direction we chose in ADR-0003 and is why the
  `nullif` is repeated here rather than simplified away.

## Alternatives rejected

- **Leave the control plane on `runGlobal`.** What the code does today. It was defensible for three
  tables holding no customer money; it is not defensible for a wallet, a card list and an invoice
  ledger whose only guard would be a predicate a developer has to remember.
- **Hang billing off `project_id`.** Would reuse the existing machinery, and would be wrong about
  the product: one `billing_customer_id` sits on `orgs`, so every project underneath draws on one
  balance. Scoping a wallet to a project shows a third of a bill and calls it the bill.
- **One `app.tenant_id` setting carrying whichever key applies.** Fewer moving parts, and it removes
  the property that makes the pair safe: a project transaction would satisfy an org policy by
  accident the moment the two id spaces met.
- **A `current_org_for_project()` lookup inside the tenant policy.** Makes every control-plane read
  depend on a project being bound, which is false for the screens that list an organisation's
  projects, and puts a subquery on the hot path of every policy evaluation.
