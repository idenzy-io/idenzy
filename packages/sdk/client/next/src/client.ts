"use client";

/**
 * The browser half, which is `@idenzy/react` under a name a Next application expects.
 *
 * Re-exported rather than reimplemented: hooks are hooks, and a second copy of the provider
 * would be a second place for the store to be wired wrongly. The directive is what makes the
 * boundary explicit at this package's edge, so a server component importing from
 * `@idenzy/next` gets a clear error instead of a mystifying one about `createContext`.
 *
 * The server half is `@idenzy/next/server`, and the middleware is `@idenzy/next/middleware`.
 */

// biome-ignore lint/performance/noBarrelFile: it carries the "use client" boundary, which is the only thing it can be.
export {
  IdenzyProvider,
  type IdenzyProviderProps,
  type SessionSnapshot,
  useIdenzy,
  useSession,
  useUser,
} from "@idenzy/react";
