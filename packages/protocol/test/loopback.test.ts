import { describe, expect, it } from "vitest";
import { isLoopbackHost } from "../src/http/loopback.js";
import { browserOriginSchema, isLoopbackOrigin } from "../src/schemas/management.js";

describe("loopback hosts", () => {
  it("are localhost, its subdomains and the two loopback literals", () => {
    for (const host of ["localhost", "LOCALHOST", "app.localhost", "auth.app.localhost"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ["127.0.0.1", "[::1]", "::1"]) expect(isLoopbackHost(host), host).toBe(true);
  });

  it("are not a public name that merely contains the word", () => {
    for (const host of [
      "localhost.example.com",
      "notlocalhost",
      "evil.com/.localhost",
      "a..localhost",
      "-a.localhost",
      "127.0.0.2",
      "",
    ]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe("the origin allowlist", () => {
  it("refuses a subdomain of localhost, which the deployment allows by itself", () => {
    expect(isLoopbackOrigin("http://app.localhost:3000")).toBe(true);
    expect(browserOriginSchema.safeParse("https://app.localhost").success).toBe(false);
  });
});
