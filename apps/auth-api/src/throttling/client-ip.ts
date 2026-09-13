import { AppConfig } from "@idenzy/config/app-config";
import { Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

/** Every request has one, even when the header is absent or a lie. */
const UNKNOWN = "unknown";

/**
 * The caller's address, in the only form a rate limit may be keyed on (PROJECT.md 4.9).
 *
 * Fastify is configured with `trustProxy: true`, which makes `request.ip` the **leftmost**
 * entry of `X-Forwarded-For`. That entry is written by the caller, so keying a limit on it
 * hands every attacker an unlimited supply of fresh buckets for the price of one header.
 * `request.ip` is therefore not used here, and the rule is to count from the right: the
 * rightmost entries were appended by proxies that actually handled the request, and
 * everything to the left of them is the caller's own contribution.
 *
 * `TRUSTED_PROXY_HOPS` says how many of those appended entries to skip. Zero — the default,
 * and what every developer machine runs — ignores the header entirely and uses the socket
 * address, which cannot be forged at all.
 */
@Injectable()
export class ClientIpResolver {
  private readonly hops: number;

  constructor(config: AppConfig) {
    this.hops = config.get("TRUSTED_PROXY_HOPS");
  }

  for(request: FastifyRequest): string {
    if (this.hops === 0) return request.socket.remoteAddress ?? UNKNOWN;

    const header = request.headers["x-forwarded-for"];
    const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
    const chain = raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    // Short chain means fewer proxies answered than we were told to expect. Falling back
    // to the socket address is the safe direction: it buckets more callers together than
    // it should, where reading past the end would read whatever the caller wrote.
    const index = chain.length - 1 - this.hops;
    return chain[index] ?? request.socket.remoteAddress ?? UNKNOWN;
  }
}
