# Repository, toolchain and data layer

Traps in the build, the package manager and the migration path, plus the rules for
adding a column, an error or a test. Read alongside [PROJECT.md](../../PROJECT.md) 4.13.

## Things that will bite you

- **pnpm settings live in `pnpm-workspace.yaml`, not `.npmrc`.** pnpm 11 does not read
  the project `.npmrc` for `ignoreScripts`, `nodeLinker` and friends. Writing them there
  looks right and silently does nothing. Verify with `pnpm config list`.
- **`pnpm run prepare` is manual after a clone**, because `ignoreScripts: true` stops
  husky installing itself.
- **Roles are not created by migrations.** `idenzy_app` and `idenzy_owner` are
  cluster-level objects created by provisioning (`infra/docker/postgres-init` locally,
  Terraform on Cloud SQL). The migrations reference `idenzy_app` in their grant statements,
  so a migration that also created the role could not run on a fresh cluster.
- **TypeScript is pinned to 6.0.x**, not 7. `@nestjs/cli` 12 depends on `typescript
  ~6.0.2` and Nest DI needs `emitDecoratorMetadata`.
- **Node cannot run this source, so `pnpm dev` compiles.** Two reasons and both are
  structural: NodeNext makes every first-party import a `./x.js` specifier, which Node does
  not resolve to the sibling `./x.ts`, and strip-only mode refuses a constructor parameter
  property — which is how every class in the codebase takes its dependencies (PROJECT.md
  7.2.2). That also rules out a stripping-based runner such as `tsx`: esbuild declines to
  emit the `design:paramtypes` metadata Nest's DI reads. The three services therefore run
  `node ../../tools/dev/src/serve.ts`, which pairs `tsc --watch` with `node --watch dist/main.js`.
  The script exists rather than the two commands sitting in `package.json` because
  `a & b` in a shell **orphans both** the moment whatever started it is killed: a stray
  compiler and a stray service still holding a port, reparented to init. Measured, not
  assumed. `turbo run dev` also builds workspace dependencies first, like every other task
  that compiles, because the apps consume `@idenzy/*` from `dist`.
- **App tests import from `dist`.** Vitest 4 transforms with Rolldown, which does not
  apply the legacy decorator semantics NestJS needs, so decorated classes fail to parse
  from source. Compiling first also means tests exercise the artifact that ships. The API's
  `typecheck` compiles too, rather than `--noEmit`: its test config reads those files'
  declarations, and on a clean checkout nothing else has written them yet.
- **The Nuxt apps' tasks take turns.** `nuxt prepare` clears `.nuxt` before writing it, and an
  app's typecheck, tests and build each run it, so in parallel one deletes the tsconfig another
  is reading. Each app's `turbo.json` orders them typecheck, then test, then build.
- **`drizzle-kit` does not generate grants, functions or partitioning.** Those are
  hand-authored migrations made with `pnpm db:custom`, in the same numbered sequence. Read
  them as SQL. It used to not generate `FORCE ROW LEVEL SECURITY` either; there is no RLS
  to force any more (PROJECT.md 4.10).
- **There are two migrations, and the second holds everything unusual.**
  `0000_baseline.sql` is generated output: every table, index and foreign key in
  `src/schema`. `0001_grants_functions_and_partitions.sql` is hand-authored and holds what
  a schema declaration cannot express — the grants, the twenty-six SECURITY DEFINER
  functions, and `audit_events` itself, which is partitioned and so is created there rather
  than in the baseline. The baseline carries two edits a regeneration would silently lose;
  they are named in its header, which is the reason to read it before running
  `pnpm db:generate` against a schema change that touches `audit_events`.
  The sixty-nine migrations these replace are in git history at `280b3cb`. A comment that
  cites *migration 0057* means one of those, and what it did is folded into `0001`.
- **A new tenant table needs its own grant migration.** `0001` grants by name, and it ran
  once. A table added later gets its DDL from `drizzle-kit` and nothing but what the
  default privileges give it — `SELECT` and `INSERT` — so the first `UPDATE` or `DELETE`
  its repository runs is a permission error on a route nobody has called yet.
  `tenancy.integration.test.ts` fails if you forget. One named statement is the whole
  migration: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.x TO idenzy_app;`
  **Name the table; do not grant by looping over `pg_class`.** `0001` grants in three
  shapes and the narrow two are the point: `audit_events` and its partitions,
  `usage_charges` and `usage_periods` are append-only; six tables hold no `DELETE`; and
  `project_purges` is granted nothing at all, because only a SECURITY DEFINER function
  writes it. A loop hands all four verbs to everything and quietly undoes each of those —
  which is how the audit trail was writable for twenty-nine migrations.
- **Default privileges outrank your migration's intent, and once did.** The defaults grant
  `SELECT, INSERT` and deliberately stop there. They used to grant all four, and because
  `audit_events` is partitioned, every partition was created holding all four the moment it
  came into existence: `DELETE FROM audit_events` was refused and
  `DELETE FROM audit_events_2026_09` was not. A default privilege cannot be narrowed per
  table — only revoked afterwards by somebody who remembered — so the verbs a table might
  need to withhold are kept out of the default and granted by name instead. If you add a
  table that must refuse a privilege, revoke it explicitly and assert the *absence* in a
  test: the grants test only checks that privileges are present, so it cannot see this
  class of bug.
- **There are two tenant scopes, not one.** `projectId` scopes a project's data and
  `orgId` scopes the organisation's — the team, the wallet, the cards, the invoices
  (ADR-0011). They were two RLS keys, and a repository built on the wrong base read nothing
  rather than everything. With the policies gone the wrong base reads **everything**, which
  is why `BaseRepository` and `OrgRepository` are still deliberately separate classes taking
  different context types: the choice is made at construction or not at all.
- **A new tenant table's grant migration is not optional even when the table is config.**
  `sms_policies` holds the spend cap, so a missing grant would not fail loudly: `idenzy_app`
  reads no policy, every project looks unconfigured, and SMS refuses everywhere.
- **`useLiteralKeys` is off** because it contradicts `noPropertyAccessFromIndexSignature`,
  which requires `process.env["X"]`. TypeScript wins.
- **Biome's `useImportType` breaks NestJS DI.** Rewriting an injected dependency to
  `import type` compiles and lints, then resolves to `undefined` in `design:paramtypes`
  and fails at boot. The rule is off for `apps/*/src/**`, and `apps/api/test/
  wiring.test.ts` compiles the composition root so the failure shows up in a test run
  rather than on a container that will not start. Biome also cannot parse `@Body()` and
  friends without `javascript.parser.unsafeParameterDecoratorsEnabled`; without it its
  analysis of every controller is wrong rather than merely absent.
- **Drizzle wraps driver errors.** A constraint violation arrives as `DrizzleQueryError`
  with the pg error, and the SQLSTATE, on `cause`. Reading `code` off the caught value
  finds nothing, which is how every unique violation was surfacing as a 500 instead of a
  409. `BaseRepository.guard` walks the cause chain.
- **`BaseRepository` is constrained to `PgTable`, not `PgTableWithColumns`.** It was
  `.enableRLS()` that forced this — it returned `Omit<PgTableWithColumns<T>, "enableRLS">`,
  which the narrower constraint rejected. The calls are gone and the constraint stays,
  because nothing gains from tightening it.
- **`drizzle-kit generate` needs a TTY when a column is dropped and another added.** It
  asks whether the pair is a rename, and there is no flag to answer. Piping input fails
  outright. Split the change into an additive migration and a drop, which is why
  `code_verifier_hash` took migrations 0007 and 0008 to become `code_verifier_encrypted`.
- **`exactOptionalPropertyTypes` means you cannot pass `undefined` for an optional
  property.** `{ transports: maybeUndefined }` does not satisfy `transports?: string[]`,
  which bites hardest when handing our own parsed types to a third-party function.
  Conditionally spread the key instead of conditionally setting the value:
  `...(x === undefined ? {} : { transports: x })`.
- **`CREATE OR REPLACE FUNCTION` cannot change a return type.** Adding an output column to
  `resolve_project_by_host` or `resolve_project_by_key_hash` means `DROP` then `CREATE`, and
  privileges do **not** survive the drop, so the `REVOKE ... FROM PUBLIC` and `GRANT EXECUTE
  ... TO idenzy_app` that `0001` pairs with it must be repeated in the same migration. Forgetting
  them fails in one way only: the function looks healthy, `idenzy_app` loses its only
  Host-to-project lookup, and every request answers `unknown_project`.
- **Throwing inside `uow.run` rolls back what the transaction already did.** That is usually
  what you want and twice now it was not: reuse detection has to survive the error it raises,
  and a failed PKCE check has to leave the exchange code spent. Both compute an outcome inside
  the transaction and throw after it commits. If a check's whole point is that something stays
  consumed, it belongs outside.
- **argon2 encodes its parameters as `m,p,t`, not `m,t,p`.** `needsRehash` used to
  prefix-match the wrong order, so it never recognised a hash it had just produced and
  every sign-in rehashed the password again. Parse the PHC string; do not match it.
- **Node has `navigator.locks`, and the refresh lock is named after the publishable key.** Two
  clients built with the same key queue behind each other, which is the whole point in a
  browser (ADR-0007) and a hang in a test file: a case that leaves a rotation unanswered holds
  the lock, and every later client for that key waits on it forever. The symptom is a binding
  that appears never to restore, with no request in the transport to explain it.
  `@idenzy/sdk-conformance` gives each client a key of its own. jsdom hides the whole problem,
  because it has no `navigator.locks` at all, so the suites that run in a browser environment
  pass either way.

## Adding a database column

1. Declare it with `classified()` inside a `classifiedTable`. The compiler enforces this.
2. `pnpm db:generate`, then read the generated SQL before committing it.
3. `pnpm compliance:generate` and commit the regenerated artifacts.
4. If it is a tenant table, confirm it carries `projectId` and that every query in its
   repository starts from `tenantScope()`. If it is an organisation table, the same
   question with `orgId` and `orgScope()` (ADR-0011) — an organisation is not a project.
   **There is no policy underneath any more** (PROJECT.md 4.10), so a query that forgets
   its scope is answered rather than refused.
5. If it is a *new* table, grant it by name in a `pnpm db:custom` migration. `0001` granted
   the tables that existed when it ran; yours gets `SELECT` and `INSERT` from the default
   privileges and nothing else, which shows up as a permission error on the first update or
   delete, on a route nobody has called yet. `tenancy.integration.test.ts` is what notices.

## Adding an error

Add the code to `@idenzy/protocol/errors/codes`, then a subclass of the right status
class in `@idenzy/core/errors`. `throw new Error(...)` is a lint error. Codes are
a public API promise: customers build every user-facing message from them, so renaming
one is a breaking change.

## Storing something a challenge has to read back

A one-time code, a link token and an exchange code are all hashed at rest, but they are
not hashed the same way and the difference is not stylistic. A 256-bit random token is
SHA-256, because there is nothing to sweep. A six-digit OTP is an **Argon2id hash**,
because a million candidates fall to an offline sweep the moment that table leaks.

The address a challenge belongs to cannot be hashed at all, because verification has to
name it in order to create the account behind it. Those columns are `encrypted()` under
the project's data key, and `otp_challenges` carries both: the hash for the "is there
already a live code" seek, the ciphertext for the read-back.

`auth_codes.code_challenge` is the mirror image of the OAuth verifier two paragraphs down.
There we are the *client* and must present the value, so it is encrypted. Here we are the
*server* and only ever compare, so we store the digest and never the verifier.

A WebAuthn challenge is the easy case and is SHA-256: 256 bits of random with nothing to
sweep, and the browser hands it back inside `clientDataJSON` so we only ever compare it.
The OAuth PKCE verifier is the one exception in the schema, encrypted rather than hashed,
because we are the client there and have to present the value itself.

## Tests are typechecked, and were not always

Every package with a `test/` directory has a `tsconfig.test.json`, and `typecheck` runs it
after the build config. Before that existed no test file in the repository was ever
typechecked, because `vitest` transpiles without checking and `tsconfig.json` includes
only `src`. A conformance suite that could not have compiled reported a pass.

## Tests that must never become optional

The audit append-only tests and the grant tests in `packages/testing`. They assert
that an attack or a mistake fails, which is the only thing that proves tenant isolation
holds when application code is wrong. A test that only exercises correct usage proves
nothing here.

