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

/**
 * What the module puts in `runtimeConfig.idenzy`, which stays on the server.
 *
 * Its own interface rather than optional fields on the public one, because the boundary
 * between them is what stops a secret reaching a bundle, and a boundary that is one property
 * name away from being crossed is not one. Nuxt fills these from `NUXT_IDENZY_*`.
 *
 * The other helpers take a built `RevocationCache`. Nuxt cannot: its options are serialised
 * into the build, so there is nowhere for a customer to hand over a live object with a timer
 * and a `close`. We own the plugin, so the module builds one instead, and the config it needs
 * to do that is what this is.
 */
export interface IdenzyServerRuntimeOptions {
  /**
   * The project's secret key, which is what the revocation endpoint takes.
   *
   * Absent, and no set is polled: verification stays signature, issuer, audience and lifetime,
   * and a revoked session is refused when its access token expires. Present, and it is refused
   * within roughly one poll (ADR-0009).
   *
   * Server-only, and the reason this interface exists. The set names users and times their
   * security events, so it is not something a browser may hold.
   */
  readonly secretKey?: string;
  /** How often to poll. Roughly the delay a revocation takes to reach this server. */
  readonly revocationPollIntervalMs?: number;
}

/** The key the module writes and the plugin reads. Spelled once so they cannot disagree. */
export const RUNTIME_CONFIG_KEY = "idenzy";

/** The payload key the seed travels under, from the server render to the hydrating client. */
export const SESSION_STATE_KEY = "idenzy:session";
