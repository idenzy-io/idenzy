# Idenzy

A managed authentication and user-management platform — the Firebase Auth / Supabase Auth / Clerk
category — delivered as a hosted service with first-class SDKs for every major web, mobile and game
platform.

**Three pillars:** extreme security by default, five-minute integration, and the lowest per-MAU price
in the market.

## What Idenzy is, and is not

Idenzy ships **a backend and SDKs**. Nothing else.

We do not ship authentication UI. There are no hosted sign-in pages, no embeddable `<SignIn/>`
component, no widget, no iframe — nothing rendered by us that a customer's end user ever sees. The
auth API speaks JSON and HTTP redirects; sign-in screens belong to the customer's application, built
with their own design system, and our SDKs give them typed headless primitives to drive.

That is a deliberate trade. It costs us the "drop in a component and you're done" demo, and it buys
the customer total control of their sign-in experience — plus it removes an entire class of XSS and
clickjacking surface from our side of the trust boundary. See `docs/adr/0002-headless-no-ui.md`.

## Repository layout

```
apps/          deployables — thin, never imported by anything
  auth-api           NestJS + Fastify, public auth API (the only service that mints tokens)
  management-api     NestJS + Fastify, dashboard/management + billing control plane
  workers            NestJS standalone — email, sms, webhook, audit, analytics consumers
  landing            Nuxt, SSR   — marketing + docs
  client             Nuxt, SPA   — customer dashboard
  admin              Nuxt, SPA   — internal operator console
packages/      all reusable logic; apps consume packages, packages never consume apps
infra/         Terraform (region cells) and container images
tools/         shared lint config, CLI, codegen
docs/          architecture decision records and compliance registers
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
pnpm install                 # lifecycle scripts are disabled by default (see .npmrc)
docker compose up -d         # Postgres 17 + Valkey
pnpm db:migrate              # apply migrations, roles, grants and RLS policies
pnpm dev                     # every app, hot reload, through Turbo
```

Useful checks:

```bash
pnpm turbo run typecheck lint build
pnpm test                    # unit
pnpm test:integration        # Testcontainers — needs Docker
pnpm compliance:generate     # regenerate the data map and RoPA from the schema
```

## Engineering rules

`PROJECT.md` §7 is **binding**, not advisory. The short version:

- TypeScript only, `strict` plus `noUncheckedIndexedAccess` and friends. `any` is a lint error.
- Class-based throughout: services, repositories, providers, guards and workers are classes obtained
  by constructor injection. Abstract base classes own the invariants; subclasses fill in what varies.
- `throw new Error(...)` is a lint error — every error is an `IdenzyError` subclass with a stable,
  machine-readable code, so "identical error codes across every SDK" is enforceable.
- Dependency direction is one-way: `apps → feature modules → domain → protocol/core`. CI fails on a
  violation or a cycle.
- Every value crossing a trust boundary is parsed by a schema before it is typed.

## Compliance

The data architecture is built to satisfy SOC 2 Type II, ISO 27001, GDPR and HIPAA — column-level
data classification, an append-only hash-chained audit trail, per-project envelope encryption,
region-pinned data residency, and first-class data-subject-request handling. See `PROJECT.md` §4.13.

**No certification is currently held or claimed.** The architecture is present so that pursuing one
is an audit rather than a rebuild.

## Licence

Proprietary. All rights reserved.
