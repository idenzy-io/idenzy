import { describe, expect, it } from "vitest";
import { IdenzyConfig } from "../src/config.js";
import { IdenzyConfigurationError } from "../src/errors.js";

describe("IdenzyConfig", () => {
  it("refuses a secret key, which is the mistake that cannot be taken back", () => {
    expect(() =>
      IdenzyConfig.parse({ publishableKey: "sk_live_abc", apiUrl: "https://auth.acme.test" }),
    ).toThrow(IdenzyConfigurationError);
  });

  it("refuses anything that is not a publishable key", () => {
    expect(() =>
      IdenzyConfig.parse({ publishableKey: "abc", apiUrl: "https://auth.acme.test" }),
    ).toThrow(IdenzyConfigurationError);
  });

  it("refuses plain http to a real host, where the key crosses in clear", () => {
    expect(() =>
      IdenzyConfig.parse({ publishableKey: "pk_live_abc", apiUrl: "http://auth.acme.test" }),
    ).toThrow(IdenzyConfigurationError);
  });

  it("allows plain http on loopback, which is where development happens", () => {
    const config = IdenzyConfig.parse({
      publishableKey: "pk_test_abc",
      apiUrl: "http://localhost:3000",
    });
    expect(config.urlFor("v1/auth/refresh")).toBe("http://localhost:3000/v1/auth/refresh");
  });

  it("counts a subdomain of localhost as loopback, which gives each local app its own cookies", () => {
    const config = IdenzyConfig.parse({
      publishableKey: "pk_test_abc",
      apiUrl: "http://auth.app.localhost:3001",
    });
    expect(config.urlFor("v1/auth/refresh")).toBe("http://auth.app.localhost:3001/v1/auth/refresh");
  });

  it("treats a blank device name as none, rather than storing an empty label", () => {
    const config = IdenzyConfig.parse({
      publishableKey: "pk_test_abc",
      apiUrl: "https://auth.acme.test",
      deviceName: "   ",
    });
    expect(config.deviceName).toBeNull();
  });

  it("truncates a device name to what the server stores, so nothing rides for nothing", () => {
    const config = IdenzyConfig.parse({
      publishableKey: "pk_test_abc",
      apiUrl: "https://auth.acme.test",
      deviceName: "d".repeat(500),
    });
    expect(config.deviceName).toHaveLength(200);
  });

  it("keeps a path prefix on the base, which a missing slash would drop", () => {
    const config = IdenzyConfig.parse({
      publishableKey: "pk_live_abc",
      apiUrl: "https://acme.test/auth",
    });
    expect(config.urlFor("v1/auth/refresh")).toBe("https://acme.test/auth/v1/auth/refresh");
  });
});
