import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { IdenzyError } from "./errors.js";
import type { Idenzy } from "./idenzy-native-js.js";
import type { IdenzyStatus, User } from "./types.js";

const IdenzyContext = createContext<Idenzy | null>(null);

/**
 * Makes one client available to the tree. The client is passed in, never built here: two clients
 * would rotate one refresh token twice and lose the session, which is the rule every binding of
 * ours keeps (docs/guide/sdk.md).
 */
export function IdenzyProvider(props: {
  readonly client: Idenzy;
  readonly children: ReactNode;
}): ReactNode {
  return <IdenzyContext.Provider value={props.client}>{props.children}</IdenzyContext.Provider>;
}

export function useIdenzy(): Idenzy {
  const client = useContext(IdenzyContext);
  if (client === null) {
    throw new IdenzyError("validation_failed", "useIdenzy needs an IdenzyProvider above it.");
  }
  return client;
}

/** The session's status, `loading` until `restore` has answered. Re-renders on every change. */
export function useIdenzyStatus(): IdenzyStatus {
  const client = useIdenzy();
  return useSyncExternalStore(
    (onChange) => client.subscribe(onChange),
    () => client.status,
  );
}

/** The signed-in user, or null while loading and when signed out. */
export function useUser(): User | null {
  const status = useIdenzyStatus();
  return status.status === "signedIn" ? status.user : null;
}
