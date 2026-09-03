/**
 * The address the auto-imports point at.
 *
 * Nuxt resolves an auto-import by file path, and the generated file lives in the customer's
 * `.nuxt`, so pointing it straight at `@idenzy/vue` would make resolution depend on the
 * customer having that package in their own dependencies. This file is inside this package,
 * which is the one thing their app is guaranteed to resolve.
 */

// biome-ignore lint/performance/noBarrelFile: it is an address, not a convenience. See above.
export { useIdenzy, useSession, useUser } from "@idenzy/vue";
