# Idenzy

An open-source authentication and user-management platform in the Firebase Auth, Supabase Auth
and Clerk category, with first-class SDKs for every major web, mobile and game platform.

**Use it hosted, or run it yourself.** The hosted service at [idenzy.io](https://idenzy.io) is the
same code, operated for you: no servers, no key management, no upgrades, priced per monthly active
user. Or deploy this repository on your own infrastructure: [docs/guide/deploy.md](./docs/guide/deploy.md)
is the procedure we run ourselves.

**Three pillars:** extreme security by default, five-minute integration, and the lowest per-MAU price
in the market.

## What Idenzy is, and is not

Idenzy ships **a backend and SDKs**. Nothing else.

We do not ship authentication UI. There are no hosted sign-in pages, no embeddable `<SignIn/>`
component, no widget, no iframe. Nothing rendered by us that a customer's end user ever sees. The
auth API speaks JSON and HTTP redirects; sign-in screens belong to the customer's application, built
with their own design system, and our SDKs give them typed headless primitives to drive.

That is a deliberate trade. It costs us the "drop in a component and you're done" demo, and it buys
the customer total control of their sign-in experience, plus it removes an entire class of XSS and
clickjacking surface from our side of the trust boundary. See `docs/adr/0002-headless-no-ui.md`.

## Repository layout

```
apps/          deployables. Thin, never imported by anything
  api                NestJS + Fastify: the auth API and the dashboard API, one service
  workers            NestJS standalone: email, webhooks, audit, analytics, erasure
  landing            marketing and docs
  client             Nuxt, SPA   the dashboard
  admin              Nuxt, SPA   the operator console
packages/      all reusable logic; apps consume packages, packages never consume apps
  sdk/               the SDKs published to npm (@idenzy/js, react, vue, next, nuxt, ...)
deploy/        the production image and the stack that runs it
infra/         Terraform
tools/         the CLI (@idenzy/cli), compliance generators, dev tooling
docs/          architecture decision records, guides and compliance registers
```

Full architecture, security model, pricing and delivery plan: **[PROJECT.md](./PROJECT.md)**.
Task-level plan: **[todo.md](./todo.md)**.

## Requirements

| Tool | Version |
|---|---|
| Node.js | see `.nvmrc` |
| pnpm | 11.x |
| Docker | for local Postgres + Valkey and integration tests |

## Getting started

```bash
pnpm install                 # lifecycle scripts are disabled (see pnpm-workspace.yaml)
pnpm run prepare             # installs git hooks; needed because ignoreScripts is on
docker compose up -d         # Postgres 17 + Valkey
pnpm db:migrate              # apply migrations, roles, grants and RLS policies
pnpm dev                     # every app, hot reload, through Turbo
```

Useful checks:

```bash
pnpm turbo run typecheck lint build
pnpm test                    # unit
pnpm test:integration        # Testcontainers, needs Docker
pnpm compliance:generate     # regenerate the data map and RoPA from the schema
```

## Engineering rules

`PROJECT.md` §7 is **binding**, not advisory. The short version:

- TypeScript only, `strict` plus `noUncheckedIndexedAccess` and friends. `any` is a lint error.
- Class-based throughout: services, repositories, providers, guards and workers are classes obtained
  by constructor injection. Abstract base classes own the invariants; subclasses fill in what varies.
- `throw new Error(...)` is a lint error. Every error is an `IdenzyError` subclass with a stable,
  machine-readable code, so "identical error codes across every SDK" is enforceable.
- Dependency direction is one-way: `apps → feature modules → domain → protocol/core`. CI fails on a
  violation or a cycle.
- Every value crossing a trust boundary is parsed by a schema before it is typed.

## Compliance

The data architecture is built to satisfy SOC 2 Type II, ISO 27001, GDPR and HIPAA: column-level
data classification, an append-only hash-chained audit trail, per-project envelope encryption, and
first-class data-subject-request handling. See `PROJECT.md` §4.13.

**Data residency is not offered.** One deployment in one region serves every customer; a project
cannot be pinned to a jurisdiction.

**No certification is currently held or claimed.** The architecture is present so that pursuing one
is an audit rather than a rebuild, and the programme itself is deliberately parked — see
`docs/compliance/TODO.md`.

## Licence

Idenzy is open source under the **GNU Affero General Public License v3.0** ([LICENSE](./LICENSE)):
use it, run it, change it. If you offer a modified Idenzy to others over a network, you share your
changes under the same licence.

**The SDKs are MIT**: every package published to npm (`@idenzy/protocol`, `core`, `js`, `node`,
the framework bindings and `@idenzy/cli`) carries its own MIT `LICENSE`, so building an
application on Idenzy never brings the AGPL into your code. Talking to an Idenzy server over its
API does not either.

Security issues: please report them privately, as [SECURITY.md](./SECURITY.md) describes.
