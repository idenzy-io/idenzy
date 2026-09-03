# Working in this repository

Read [PROJECT.md](./PROJECT.md) before making architectural decisions. Section 7 is
binding, not advisory: a change that violates it does not get merged regardless of how
well it works.

## The two rules that surprise people

**We ship no authentication UI.** No hosted pages, no components, no widgets, no
iframes. The auth API returns JSON and HTTP redirects, and an endpoint returning
`text/html` is a bug with a test asserting against it. If a task seems to need a sign-in
screen, the answer is an SDK primitive plus a docs example the customer owns. See
PROJECT.md 1.1 and `docs/adr/0002-headless-no-ui.md`.

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

## Things that will bite you

- **pnpm settings live in `pnpm-workspace.yaml`, not `.npmrc`.** pnpm 11 does not read
  the project `.npmrc` for `ignoreScripts`, `nodeLinker` and friends. Writing them there
  looks right and silently does nothing. Verify with `pnpm config list`.
- **`pnpm run prepare` is manual after a clone**, because `ignoreScripts: true` stops
  husky installing itself.
- **Roles are not created by migrations.** `idenzy_app` and `idenzy_owner` are
  cluster-level objects created by provisioning (`infra/docker/postgres-init` locally,
  Terraform on Cloud SQL). Migration 0000 references `idenzy_app` in its `CREATE POLICY`
  statements, so a migration that also created the role could not run on a fresh cluster.
- **TypeScript is pinned to 6.0.x**, not 7. `@nestjs/cli` 12 depends on `typescript
  ~6.0.2` and Nest DI needs `emitDecoratorMetadata`.
- **App tests import from `dist`.** Vitest 4 transforms with Rolldown, which does not
  apply the legacy decorator semantics NestJS needs, so decorated classes fail to parse
  from source. Compiling first also means tests exercise the artifact that ships.
- **`drizzle-kit` does not generate roles, grants, `FORCE ROW LEVEL SECURITY` or
  partitioning.** Those are hand-authored migrations made with `pnpm db:custom`, in the
  same numbered sequence. Read them as SQL.
- **`useLiteralKeys` is off** because it contradicts `noPropertyAccessFromIndexSignature`,
  which requires `process.env["X"]`. TypeScript wins.
- **Biome's `useImportType` breaks NestJS DI.** Rewriting an injected dependency to
  `import type` compiles and lints, then resolves to `undefined` in `design:paramtypes`
  and fails at boot. The rule is off for `apps/*/src/**`, and `apps/auth-api/test/
  wiring.test.ts` compiles the composition root so the failure shows up in a test run
  rather than on a container that will not start. Biome also cannot parse `@Body()` and
  friends without `javascript.parser.unsafeParameterDecoratorsEnabled`; without it its
  analysis of every controller is wrong rather than merely absent.
- **Drizzle wraps driver errors.** A constraint violation arrives as `DrizzleQueryError`
  with the pg error, and the SQLSTATE, on `cause`. Reading `code` off the caught value
  finds nothing, which is how every unique violation was surfacing as a 500 instead of a
  409. `BaseRepository.guard` walks the cause chain.
- **`.enableRLS()` changes the table's type** to `Omit<PgTableWithColumns<T>,
  "enableRLS">`, so a generic constrained to `PgTableWithColumns` rejects every table in
  our schema. `BaseRepository` is constrained to `PgTable`.
- **argon2 encodes its parameters as `m,p,t`, not `m,t,p`.** `needsRehash` used to
  prefix-match the wrong order, so it never recognised a hash it had just produced and
  every sign-in rehashed the password again. Parse the PHC string; do not match it.

## Adding a database column

1. Declare it with `classified()` inside a `classifiedTable`. The compiler enforces this.
2. `pnpm db:generate`, then read the generated SQL before committing it.
3. `pnpm compliance:generate` and commit the regenerated artifacts.
4. If it is a tenant table, confirm it carries `projectId` and a tenant isolation policy.

## Adding an error

Add the code to `@idenzy/protocol/errors/codes`, then a subclass of the right status
class in `@idenzy/core/errors/errors`. `throw new Error(...)` is a lint error. Codes are
a public API promise: customers build every user-facing message from them, so renaming
one is a breaking change.

## Adding an authentication flow

Extend `AuthFlow` in `@idenzy/domain` and implement `verify` only. The base owns MFA
gating, hook invocation, session creation and audit ordering, and a flow that wanted to
skip any of them would have to stop extending it, which is visible in a diff. Sign-up is
an `AuthFlow` too: establishing the subject there means creating them.

`FlowHooks` and `FlowAudit` are interfaces, so they are injected with the symbol tokens
in `apps/auth-api/src/flows/flow-tokens.ts` rather than by type.

Anything security-critical needs a test that asserts the attack fails (PROJECT.md 7.4),
not only that the happy path works. The existing ones are the models: refresh reuse
revoking the family, revoking a stranger's session answering 404, and a missing user
costing the same Argon2 work as a wrong password.

## Adding a provider, factor or channel

Extend the family's abstract base in `@idenzy/domain/ports` and implement only what
varies. The base owns what must never be skipped: the state check for OAuth, the
suppression check for email, the spend reservation for SMS. Do not re-implement those in
a subclass, and do not add an abstraction until there are two real implementations.

## Tests that must never become optional

The RLS negative tests and the audit append-only tests in `packages/testing`. They assert
that an attack or a mistake fails, which is the only thing that proves tenant isolation
holds when application code is wrong. A test that only exercises correct usage proves
nothing here.

## Compliance claims

The architecture is built for SOC 2, ISO 27001, GDPR and HIPAA. **No certification is
held.** Nothing in this repository may be quoted to a customer as a compliance claim, and
PROJECT.md 4.13.10 lists exactly what is not being done.

## Style

Conventional Commits, machine-checked. Docstrings short and informative: say what a thing
does and why it exists, plus the non-obvious constraint if there is one. Do not restate
the signature.
