// Named rather than default: the package is CJS with ESM-shaped types, so under NodeNext
// the default import resolves to the module namespace and is not constructable.
import { Valkey } from "iovalkey";

/**
 * The client, named here so nothing outside this package has to depend on the driver.
 * Swapping iovalkey is then a change in this file rather than in every consumer.
 */
export type ValkeyClient = Valkey;

export interface ValkeyOptions {
  readonly url: string;
  /**
   * How long one command may take before it is abandoned. Small on purpose: everything
   * this client is used for sits next to a request that must not wait on it.
   */
  readonly commandTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  /**
   * Where connection failures go.
   *
   * Required rather than optional, because a client with no `error` listener reports a
   * refused connection as an unhandled event and nothing else: an outage would then be
   * visible only as whatever the callers failed to do. It is a callback rather than a
   * Logger so that a connection concern does not decide this package's dependencies.
   */
  readonly onError: (error: Error) => void;
}

/**
 * The Valkey client, configured to fail fast rather than to try hard (PROJECT.md 8.2).
 *
 * Every default here is the opposite of the library's, and for one reason: nothing this
 * cache does is worth making a request slower. A revocation write is backed by the outbox
 * event in the same transaction (ADR-0009) and a rate-limit check fails open, so a
 * command that cannot complete promptly should give up and let the caller carry on.
 */
export function createValkeyClient(options: ValkeyOptions): ValkeyClient {
  return new Valkey(options.url, {
    /**
     * Commands issued in one tick go out as one round trip. The revocation set reads
     * three keys to answer one question, so this is the difference between one network
     * hop and three.
     */
    enableAutoPipelining: true,
    /**
     * A command issued while disconnected fails immediately instead of waiting in a
     * queue for a reconnect. The queue is the wrong behaviour here: it converts a Valkey
     * outage into latency on our own endpoints, and it can replay a revocation write
     * minutes later against state that has moved on.
     */
    enableOfflineQueue: false,
    /**
     * One retry, not twenty. The caller's fallback is cheaper than the retries, and a
     * command retried twenty times is an endpoint hanging on a dependency it was
     * designed to survive.
     */
    maxRetriesPerRequest: 1,
    commandTimeout: options.commandTimeoutMs ?? 250,
    connectTimeout: options.connectTimeoutMs ?? 1000,
  }).on("error", options.onError);
}
