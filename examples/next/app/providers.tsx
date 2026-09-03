"use client";

import { IdenzyProvider, type SessionSnapshot } from "@idenzy/next";
import type { ReactNode } from "react";
import { idenzy } from "../lib/idenzy";

/**
 * Put this around your tree in app/layout.tsx:
 *
 *   const session = await idenzyServer.session();
 *   return (
 *     <html lang="en">
 *       <body>
 *         <Providers initialSession={session}>{children}</Providers>
 *       </body>
 *     </html>
 *   );
 *
 * Hand the seed over even when it is null, and especially then. Null is the server reporting
 * that it looked and could not place the visitor, which holds the tree in "loading" until the
 * browser settles it. Leaving the prop out says nobody looked, and renders your signed-out
 * screen at somebody whose refresh cookie is about to sign them straight back in.
 */
export function Providers({
  children,
  initialSession,
}: {
  readonly children: ReactNode;
  readonly initialSession: SessionSnapshot | null;
}): ReactNode {
  return (
    <IdenzyProvider client={idenzy} initialSession={initialSession}>
      {children}
    </IdenzyProvider>
  );
}
