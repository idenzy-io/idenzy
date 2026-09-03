import { IDENZY_PROJECT_ID } from "$env/static/private";
import { PUBLIC_IDENZY_API_URL } from "$env/static/public";
import { createIdenzyHandle } from "@idenzy/svelte/server";

/**
 * Verifies the session cookie against a cached key set, with no network call on the request
 * path, and puts the answer on event.locals.idenzy.
 *
 * Built once, at module scope: the key set is cached inside the handle, and one per request
 * would fetch the key set per request. It never throws, so a key-set outage renders pages
 * that say "not sure yet" rather than 500s.
 */
export const handle = createIdenzyHandle({
  projectId: IDENZY_PROJECT_ID,
  issuerUrl: PUBLIC_IDENZY_API_URL,
});
