import { SetMetadata } from "@nestjs/common";

export const BROWSER_NAVIGATION = "idenzy:browser-navigation";

/**
 * Marks a route the browser reaches by navigating, not by `fetch`.
 *
 * The magic-link callback, the OAuth start and both OAuth callbacks are all reached by a
 * top-level navigation or a third-party form post, so the cross-site checks that protect
 * cookie mode cannot apply to them. Apple form-posts its callback with
 * `Origin: https://appleid.apple.com`, and a blanket Origin check would break Sign in with
 * Apple outright.
 *
 * They are not undefended, they are defended differently: a one-shot `state` and a
 * single-use code, both of which already exist. The decorator makes that exemption a
 * visible line in a diff rather than a list of URLs buried in a guard.
 */
export const BrowserNavigation = (): MethodDecorator & ClassDecorator =>
  SetMetadata(BROWSER_NAVIGATION, true);
