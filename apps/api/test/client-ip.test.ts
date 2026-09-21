import "reflect-metadata";
import type { AppConfig } from "@idenzy/config/app-config";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { ClientIpResolver } from "../dist/throttling/client-ip.js";

const configWith = (hops: number): AppConfig => ({ get: () => hops }) as unknown as AppConfig;

const requestWith = (forwardedFor: string | undefined, socket = "10.0.0.1"): FastifyRequest =>
  ({
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
    socket: { remoteAddress: socket },
  }) as unknown as FastifyRequest;

describe("ClientIpResolver", () => {
  describe("with no trusted proxies", () => {
    const resolver = new ClientIpResolver(configWith(0));

    it("uses the socket address", () => {
      expect(resolver.for(requestWith(undefined))).toBe("10.0.0.1");
    });

    /**
     * The whole point of the class. A limiter keyed on a header the caller writes gives
     * every attacker as many buckets as they care to invent.
     */
    it("ignores X-Forwarded-For entirely", () => {
      expect(resolver.for(requestWith("1.2.3.4"))).toBe("10.0.0.1");
    });
  });

  describe("behind one proxy that appends its own address", () => {
    const resolver = new ClientIpResolver(configWith(1));

    it("reads the client from the right, past the proxy", () => {
      expect(resolver.for(requestWith("203.0.113.9, 10.1.1.1"))).toBe("203.0.113.9");
    });

    /**
     * The attack this defends against, stated as a test: the caller prepends an address
     * of their choosing, and it must not be the one we count against.
     */
    it("cannot be moved by a value the caller prepended", () => {
      const spoofed = resolver.for(requestWith("evil, 203.0.113.9, 10.1.1.1"));
      expect(spoofed).toBe("203.0.113.9");
      expect(spoofed).not.toBe("evil");
    });

    it("gives one attacker one bucket however many addresses they invent", () => {
      const first = resolver.for(requestWith("a, b, c, 203.0.113.9, 10.1.1.1"));
      const second = resolver.for(requestWith("x, 203.0.113.9, 10.1.1.1"));
      expect(first).toBe(second);
    });

    it("falls back to the socket when the chain is shorter than promised", () => {
      expect(resolver.for(requestWith("10.1.1.1"))).toBe("10.0.0.1");
      expect(resolver.for(requestWith(undefined))).toBe("10.0.0.1");
    });

    it("tolerates the whitespace a real header carries", () => {
      expect(resolver.for(requestWith("  203.0.113.9 ,  10.1.1.1  "))).toBe("203.0.113.9");
    });
  });

  describe("behind two hops", () => {
    const resolver = new ClientIpResolver(configWith(2));

    it("skips both", () => {
      expect(resolver.for(requestWith("203.0.113.9, 10.1.1.1, 10.2.2.2"))).toBe("203.0.113.9");
    });
  });
});
