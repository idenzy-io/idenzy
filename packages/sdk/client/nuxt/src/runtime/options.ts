import type { SessionTransportPreference } from "@idenzy/js/http/transport-mode";

/**
 * What the module puts in `runtimeConfig.public.idenzy`, and therefore what ships to the
 * browser. Nothing here is a secret: a publishable key is meant to sit in a bundle, and a
 * project id and an issuer URL are both public by construction.
 */
export interface IdenzyRuntimeOptions {
  readonly publishableKey: string;
  readonly apiUrl: string;
  readonly sessionTransport?: SessionTransportPreference;
  readonly deviceName?: string;
  /**
   * The project the server checks a session cookie against, which is what lets a page be
   * rendered for a signed-in user without a round trip.
   *
   * Absent means the server renders `loading` and the browser works it out, which is correct
   * and simply slower to the first useful paint. Present, it must be this project: one issuer
   * serves every project, so the audience is the only thing separating tenants.
   */
  readonly projectId?: string;
  /** Defaults to `apiUrl`, which is where the tokens say they came from. */
  readonly issuerUrl?: string;
}

/** The key the module writes and the plugin reads. Spelled once so they cannot disagree. */
export const RUNTIME_CONFIG_KEY = "idenzy";

/** The payload key the seed travels under, from the server render to the hydrating client. */
export const SESSION_STATE_KEY = "idenzy:session";
