import { InternalError } from "@idenzy/core/errors";

/**
 * A data store whose connection string has to be checked, and what it is called in an error.
 *
 * All three, because all three will one day be somewhere else. On one box they are loopback and
 * exempt; the check is here so that stops being true loudly rather than silently.
 */
export interface CheckedConnection {
  readonly name: string;
  readonly value: string | undefined;
}

/** Loopback and unix sockets. On a laptop there is no network to protect. */
function isLocal(host: string): boolean {
  return (
    host.startsWith("/") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    // Compose service names: postgres, valkey, clickhouse on a private bridge network.
    !host.includes(".")
  );
}

function hostOf(connectionString: string): string {
  // Postgres DSNs can carry a socket directory in `host=`, which URL parsing cannot represent.
  const socket = /[?&]host=([^&]+)/.exec(connectionString);
  if (socket?.[1] !== undefined) return decodeURIComponent(socket[1]);
  try {
    return new URL(connectionString).hostname;
  } catch {
    return "";
  }
}

/**
 * Whether a Postgres DSN asks for TLS that actually authenticates the server.
 *
 * `sslmode=require` is the trap and is why this is not a substring check for "ssl". It encrypts
 * and **does not verify the certificate**, so it stops a passive eavesdropper and does nothing
 * about anyone who can answer in the server's place — which, on a connection crossing the public
 * internet to an IP address, is the attack that matters. Only `verify-ca` and `verify-full` check
 * the chain, and only `verify-full` checks the hostname too.
 */
function postgresVerifiesServer(connectionString: string): boolean {
  const mode = /[?&]sslmode=([a-z-]+)/.exec(connectionString)?.[1];
  return mode === "verify-full" || mode === "verify-ca";
}

function isEncryptedScheme(connectionString: string): boolean {
  return /^(rediss|https|postgresql?s):\/\//.test(connectionString);
}

/**
 * Refuses a deployment whose data stores are reachable in clear text (PROJECT.md 4.11).
 *
 * **A guard for a topology we are deliberately not adopting yet.** `node-postgres` defaults to no
 * TLS, which was harmless while Postgres was Cloud SQL on a private IP with no public path to it.
 * Stage one puts everything on one high-end VPS — APIs, Postgres, Valkey, ClickHouse, workers — so
 * there is no wire between them either, and every check here is a no-op on loopback.
 *
 * It exists for the split that eventually comes. The moment one store moves to another host, a
 * connection string missing one parameter is the difference between a private query and a public
 * one, and nothing else in the system would notice.
 *
 * Without this, a `DATABASE_URL` missing one query parameter sends every password hash, session
 * token and email address in the clear, and nothing anywhere would say so. The connection works.
 * That is the whole problem: it is not a failure mode, it is a silent success.
 *
 * Development is exempt, as is anything on loopback, a unix socket or a compose service name.
 * Everywhere else this throws at boot, because a process that has already accepted a request has
 * already leaked one.
 */
export function assertTransportSecurity(
  environment: string,
  connections: readonly CheckedConnection[],
): void {
  if (environment === "development") return;

  for (const { name, value } of connections) {
    if (value === undefined || value === "") continue;
    const host = hostOf(value);
    if (isLocal(host)) continue;

    const postgres = value.startsWith("postgres");
    const secure = postgres ? postgresVerifiesServer(value) : isEncryptedScheme(value);
    if (secure) continue;

    throw new InternalError({
      detail: {
        setting: name,
        host,
        environment,
        reason: postgres
          ? "the DSN does not request sslmode=verify-full, so the connection is either in the clear or unauthenticated"
          : "the URL is not on an encrypted scheme",
        // Named rather than hinted: `sslmode=require` is the answer people reach for and it is the
        // wrong one, because it encrypts without checking who answered.
        remedy: postgres
          ? "append ?sslmode=verify-full (require encrypts without verifying the server)"
          : "use rediss:// or https://",
        rule: "a store reached across a network is reached over verified TLS (PROJECT.md 4.11)",
      },
    });
  }
}
