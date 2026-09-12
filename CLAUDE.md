# Working in this repository

Read [PROJECT.md](./PROJECT.md) before making architectural decisions. Section 7 is
binding, not advisory: a change that violates it does not get merged regardless of how
well it works.

This file is the index. The detail lives in `docs/guide/`, one file per area, and **the
file for the area you are touching is required reading, not background**. Each one
records why a decision was made, which is usually the only thing standing between a
sensible-looking change and a silent failure.

## The two rules that surprise people

**We ship no authentication UI.** No hosted pages, no components, no widgets, no
iframes. The auth API returns JSON and HTTP redirects, and an endpoint returning
`text/html` is a bug with a test asserting against it. If a task seems to need a sign-in
screen, the answer is an SDK primitive plus a docs example the customer owns. See
PROJECT.md 1.1 and `docs/adr/0002-no-authentication-ui.md`.

**Every database column is declared through `classified()`.** It is not a convention:
`classifiedTable` accepts only branded builders, so an unclassified column fails to
compile. Those declarations generate the RoPA, the data map, the log allowlist and the
data-subject field lists, so a column that escapes them escapes all four. See
PROJECT.md 4.13.2.

## Commands

```bash
pnpm install && pnpm run prepare   # prepare installs git hooks; ignoreScripts is on
docker compose up -d && pnpm db:migrate
pnpm dev                           # every app through turbo

pnpm turbo run typecheck build test
pnpm lint                          # biome, a root script and not a turbo task
pnpm turbo run test:integration    # Testcontainers, needs Docker
pnpm compliance:generate           # after any schema change; CI fails if stale
```

## Where to read before you change something

| If you are touching | Read |
| --- | --- |
| the toolchain, a migration, a column, an error code, a test | [docs/guide/repo.md](./docs/guide/repo.md) |
| the auth API, a flow, MFA, passkeys, claims, SMS, revocation, the audit trail | [docs/guide/backend.md](./docs/guide/backend.md) |
| `@idenzy/js`, a framework binding, an SSR helper, `@idenzy/node`, the CLI | [docs/guide/sdk.md](./docs/guide/sdk.md) |
| `apps/client` generally — its stack, shared components, charts, code blocks | [docs/guide/panel.md](./docs/guide/panel.md) |
| one screen of the panel | its `notes/` file, then [docs/guide/panel-screens.md](./docs/guide/panel-screens.md) |

`notes/` holds one file per screen, plus `notes/layout-blueprint.md`,
`notes/dialogs.md` and `notes/shared-experience.md`. They are proposed specifications
rather than descriptions, and where a note and the code disagree **the note is the
target and the disagreement is usually the finding**.

Architecture decisions are in `docs/adr/`. The ones cited most often: 0002 (no auth UI),
0006 (origins are their own allowlist), 0007 (no grace window on refresh rotation),
0008 (the browser SDK stores no refresh token), 0009 (the revocation set is a published
snapshot), 0010 (an authentication answers with a session or a challenge), 0011 (the
control plane has its own tenant key).

## Compliance claims

The architecture is built for SOC 2, ISO 27001, GDPR and HIPAA. **No certification is
held.** Nothing in this repository may be quoted to a customer as a compliance claim, and
PROJECT.md 4.13.10 lists exactly what is not being done.

## Style

Conventional Commits, machine-checked. Docstrings short and informative: say what a thing
does and why it exists, plus the non-obvious constraint if there is one. Do not restate
the signature.
