# ADR-0005: Biome instead of ESLint and Prettier

- Status: accepted
- Date: 2026-09-03

## Context

PROJECT.md §7 is binding rather than advisory, which only means something if the rules are mechanical.
The bans that matter are: no `any`, no `throw new Error(...)`, `readonly` on injected dependencies,
and the §8.3 layer boundaries. If those live only in review comments they will be enforced
inconsistently and then not at all.

The default choice is ESLint with typescript-eslint plus Prettier. It works, and its type-aware rules
are the strongest in the ecosystem. It is also slow enough on a monorepo that people start scoping it
to changed files and eventually skip it locally.

## Decision

Use **Biome** for both formatting and linting, replacing ESLint and Prettier entirely. One tool, one
config file, one pass over the tree.

## What was verified before deciding

The concern with Biome has always been the type-aware rules. That concern is now out of date. Checked
against Biome 2.5.11:

| Requirement | Rule |
|---|---|
| the `any` ban (§7.1) | `suspicious/noExplicitAny` |
| `readonly` on injected dependencies (§7.2.7) | `style/useReadonlyClassProperties` |
| layer boundaries (§8.3) | `style/noRestrictedImports`, per package via `overrides` |
| unawaited audit and outbox writes | `nursery/noFloatingPromises`, `nursery/noMisusedPromises`, both type-aware |
| unqualified writes on multi-tenant tables | `nursery/noDrizzleDeleteWithoutWhere`, `nursery/noDrizzleUpdateWithoutWhere` |
| cold-start discipline (§5.2 lever 7) | `performance/noBarrelFile`, `performance/noReExportAll` |
| env access only in `@idenzy/config` | `style/noProcessEnv` |
| `!` hiding what `noUncheckedIndexedAccess` surfaces | `style/noNonNullAssertion` |

`noFloatingPromises` works on Biome's own type inference, with no project service configuration. For
an auth service where a dropped audit write is a real bug class, that rule was the gate on this
decision.

The one genuine gap is that Biome has no `noRestrictedSyntax`, so the `throw new Error(...)` ban needs
a custom rule. Biome 2 supports **GritQL plugins**, and a five-line plugin covers it:

```grit
language js

`throw new $ctor($...)` as $stmt where {
  $ctor <: or { `Error`, `TypeError`, `RangeError` },
  register_diagnostic(span = $stmt, message = "...", severity = "error")
}
```

This was tested against a sample file and reports correctly. Custom rules live in
`tools/biome-plugins/`.

## Why speed is a correctness argument here

A linter that runs in under a second on the whole monorepo runs on every save and in a pre-commit
hook without anyone disabling it. A linter that takes a minute gets scoped, then skipped, then argued
with. The §7 rules are only worth writing down if they are actually applied to every change.

## What we give up

- **The typescript-eslint rule catalogue is larger.** Rules like `no-unnecessary-condition` and
  `strict-boolean-expressions` have no Biome equivalent yet. If we find we need one badly, adding a
  narrow ESLint pass for type-aware rules only is a reversible change.
- **Some rules are in `nursery`**, which means they can change between minor versions. The Biome
  version is pinned exactly and upgrades are deliberate.
- **A smaller plugin ecosystem.** GritQL covers the project-specific bans, which is what we needed it
  for.

## Supporting tools

- **husky** for git hooks, **lint-staged** running `biome check --write` on staged files,
  **commitlint** enforcing Conventional Commits.
- Because `.npmrc` sets `ignore-scripts=true` for supply-chain reasons (§7.6), husky's `prepare`
  script does not run automatically on install. `pnpm run prepare` is run once after cloning, and the
  README and bootstrap script both say so.
- Hooks catch mistakes early. **CI is the gate**, and no rule is allowed to exist only in a hook.
