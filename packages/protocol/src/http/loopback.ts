/**
 * Which hosts are this machine, for the rules that relax there and nowhere else.
 *
 * Four readers ask: the SDK lets an http API URL through, the CORS layer allows the origin
 * outside production, the origin allowlist refuses to store one, and OAuth's instant mode
 * accepts the return address. Each kept its own list, and a host one of them counted and
 * another did not is a development setup that fails at the second step for no stated reason.
 *
 * `*.localhost` is loopback too (RFC 6761 reserves the name for it, and browsers resolve it
 * there and treat it as a secure context). It matters because cookies are scoped by host and
 * not by port: two applications on `localhost:3000` and `localhost:4000` share one cookie jar,
 * so each one's session overwrites the other's. `app-a.localhost` and `app-b.localhost` are
 * two hosts, which is how several applications run side by side in cookie mode on one laptop.
 *
 * Only `127.0.0.1` of the IPv4 loopback block: it is the one address anybody types, and the
 * rest of `127.0.0.0/8` widening a development exception is a cost with no reader.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return isDnsName(host);
  return host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Labels of letters, digits and inner hyphens, so `evil.com/.localhost` is not a host. */
function isDnsName(host: string): boolean {
  return host.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label));
}
