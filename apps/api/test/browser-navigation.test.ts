import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { BROWSER_NAVIGATION } from "../dist/http/browser-navigation.decorator.js";
import { MagicLinkController } from "../dist/magic-link/magic-link.controller.js";
import { OAuthController } from "../dist/oauth/oauth.controller.js";

/**
 * The complete list of routes that skip the cross-site checks, written out so that adding a
 * fifth is a failing test rather than a review someone has to catch.
 *
 * Each is a top-level navigation or a provider's form post, which is the only reason the
 * exemption is defensible: Apple posts its callback with `Origin: https://appleid.apple.com`,
 * so an Origin check there would break Sign in with Apple for everyone. What defends them
 * instead is a one-shot `state` and a single-use code, and that substitution is exactly what
 * a route added to this list would have to argue for.
 */
const EXEMPT = [
  "OAuthController.start",
  "OAuthController.callback",
  "OAuthController.callbackPosted",
  "MagicLinkController.callback",
];

// biome-ignore lint/complexity/noBannedTypes: a controller is a constructor, and this reads its prototype rather than calling it.
function exemptions(name: string, controller: Function): string[] {
  const prototype = controller.prototype as object;
  return Object.getOwnPropertyNames(prototype)
    .filter((method) => method !== "constructor")
    .filter((method) => {
      const handler = (prototype as Record<string, unknown>)[method];
      return (
        typeof handler === "function" && Reflect.getMetadata(BROWSER_NAVIGATION, handler) === true
      );
    })
    .map((method) => `${name}.${method}`);
}

describe("@BrowserNavigation", () => {
  it("is carried by exactly the routes a browser reaches directly", () => {
    const found = [
      ...exemptions("OAuthController", OAuthController),
      ...exemptions("MagicLinkController", MagicLinkController),
    ];
    expect(found.sort()).toEqual([...EXEMPT].sort());
  });

  it("does not exempt the json start, which is what makes it stricter than the redirect", () => {
    expect(exemptions("OAuthController", OAuthController)).not.toContain(
      "OAuthController.startAsJson",
    );
  });
});
