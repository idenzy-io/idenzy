import { PUBLIC_IDENZY_API_URL, PUBLIC_IDENZY_PUBLISHABLE_KEY } from "$env/static/public";
import { Idenzy } from "@idenzy/js";

/**
 * A client per load, never a module singleton.
 *
 * A module-level client on a server is shared between requests, and a session shared between
 * requests is a session shared between people. In the browser this is called once, from the
 * root layout, which is the one client the whole tab uses.
 */
export function createIdenzyClient(): Idenzy {
  return new Idenzy({
    publishableKey: PUBLIC_IDENZY_PUBLISHABLE_KEY,
    apiUrl: PUBLIC_IDENZY_API_URL,
  });
}
