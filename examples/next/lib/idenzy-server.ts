import { IdenzyServer } from "@idenzy/next/server";

/**
 * The server half: it verifies the session cookie against a cached key set, with no network
 * call on the request path.
 *
 * Built once, at module scope. One of these per request would fetch the key set per request.
 */
export const idenzyServer = new IdenzyServer({
  projectId: process.env.IDENZY_PROJECT_ID ?? "",
  issuerUrl: process.env.NEXT_PUBLIC_IDENZY_API_URL ?? "",
});
