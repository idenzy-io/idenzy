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
  Terraform on Cloud SQL). Migration 0000 references `idenzy_app` in its `CREATE POLICY`
  statements, so a migration that also created the role could not run on a fresh cluster.
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
  from source. Compiling first also means tests exercise the artifact that ships.
- **`drizzle-kit` does not generate roles, grants, `FORCE ROW LEVEL SECURITY` or
  partitioning.** Those are hand-authored migrations made with `pnpm db:custom`, in the
  same numbered sequence. Read them as SQL.
- **A new tenant table needs its own FORCE RLS and grant migration.** Migration 0001
  applied both by looping over the tables that existed when it ran, and it ran once. A
  table added later gets its policy from `drizzle-kit` and neither FORCE nor a grant,
  which means `idenzy_app` cannot read it at all and the owner can read across tenants.
  Two tests in `packages/testing` fail if you forget.
  **Name the table; do not copy the dynamic blocks from `0004_nasty_catseye.sql`.** They
  grant all four verbs on every table except `audit_events`, and three tables now
  deliberately refuse one: every `audit_events_*` partition (append-only, narrowed in 0030)
  and `payment_provider_events` (no `DELETE`). Copying them re-grants what those migrations
  withheld, which is how `0042` was first written and what the append-only tests caught.
  Two named statements are the whole migration:
  `ALTER TABLE public.x FORCE ROW LEVEL SECURITY;` and
  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.x TO idenzy_app;`
- **Default privileges outrank your migration's intent, and did so twice.** Migration
  0001 ends with `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE`, so
  for three migrations every `audit_events` partition was created holding all four:
  `DELETE FROM audit_events` was refused and `DELETE FROM audit_events_2026_09` was not.
  0030 revoked the two dangerous verbs from the defaults and made
  `ensure_audit_partition` revoke them itself. If you add a table that must refuse a
  privilege, revoke it explicitly and assert the *absence* in a test — the grants test
  only checks that privileges are present, so it cannot see this class of bug.
- **There are two tenant keys, not one.** `app.project_id` scopes a project's data and
  `app.org_id` scopes the organisation's — the team, the wallet, the cards, the invoices
  (ADR-0011). Neither satisfies the other's policy, so a repository built on the wrong
  base reads nothing rather than reading everything, and `BaseRepository` and
  `OrgRepository` are deliberately separate classes so the choice is made at construction.
- **A new tenant table's grant migration is not optional even when the table is config.**
  `sms_policies` holds the spend cap, so a missing grant would not fail loudly: `idenzy_app`
  reads no policy, every project looks unconfigured, and SMS refuses everywhere.
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
  ... TO idenzy_app` from migration 0002 must be repeated in the same migration. Forgetting
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
4. If it is a tenant table, confirm it carries `projectId` and a tenant isolation policy.
   If it is an organisation table, the same question with `orgId` and `orgIsolationPolicy`
   (ADR-0011) — the control plane has its own key and `UnitOfWork.runForOrg` sets it.
5. If it is a *new* table, add the FORCE RLS and grant blocks in a `pnpm db:custom`
   migration. See the note above; the policy alone is not enough. The two `DO` blocks are
   dynamic and cover either key, so they need no edit for an org-scoped table.

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

The RLS negative tests and the audit append-only tests in `packages/testing`. They assert
that an attack or a mistake fails, which is the only thing that proves tenant isolation
holds when application code is wrong. A test that only exercises correct usage proves
nothing here.

