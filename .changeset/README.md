# Changesets

A change to a published SDK package (`@idenzy/protocol`, `core`, `js`, `vue`, `node`,
`nuxt`) comes with a changeset: `pnpm changeset`, pick the bump, write one line a customer
would want to read. The six share one version (`fixed` in config.json), so a customer never
has to match them up.

On main, the release workflow turns pending changesets into a "Version Packages" pull
request; merging it publishes. See docs/guide/sdk.md, "Releasing".
