import { IdenzyProvider } from "@idenzy/react";
import type { ReactNode } from "react";
import { idenzy } from "../idenzy";

/**
 * Put this around your application, once, in src/main.tsx.
 *
 * The client is a prop rather than something this component builds, and that is not a style
 * choice: a render that built one would put a second client on the page, and two clients
 * rotating the same refresh token end every session the user holds.
 */
export function IdenzyRoot({ children }: { readonly children: ReactNode }): ReactNode {
  return <IdenzyProvider client={idenzy}>{children}</IdenzyProvider>;
}
