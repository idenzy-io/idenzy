import { SessionTransport } from "@idenzy/protocol/http/headers";

/**
 * What a client asks for. `auto` starts in cookie mode and accepts the server's answer.
 *
 * Naming a mode explicitly means it is the only one you will get: an explicit `cookie` that
 * cannot work is an error the developer sees, not a downgrade that happens behind them.
 */
export type SessionTransportPreference = SessionTransport | "auto";

/**
 * Which transport this client is using, and the one downgrade it is allowed to make.
 *
 * Cookie mode is better and cannot always work. It needs a custom auth domain, because
 * `SameSite` is a *site* rule: `app.customer.com` to `auth.customer.com` is same-site and the
 * cookie flows, while `app.customer.com` to our shared API host is cross-site and it never
 * will. Asking anyway is answered plainly with `session_transport_unavailable` rather than
 * granted and silently dropped, and this is the half of that exchange that lives on the client.
 *
 * Optimistic rather than configured, because the client cannot tell from its own URL. A custom
 * auth domain is a CNAME; it looks like any other host from here, and the only party that knows
 * whether one is verified is the server. So `auto` asks for the better mode, and pays one
 * refused request per client on the deployments that cannot have it.
 *
 * The downgrade is one-way. Nothing here upgrades a client back to cookie mode, because the
 * only evidence it could act on is the absence of a refusal, which is not evidence.
 */
export class TransportMode {
  private mode: SessionTransport;
  private readonly negotiable: boolean;
  private announced = false;

  constructor(
    preference: SessionTransportPreference = "auto",
    private readonly announce: (message: string) => void = warnOnce,
  ) {
    this.negotiable = preference === "auto";
    this.mode =
      preference === SessionTransport.Header ? SessionTransport.Header : SessionTransport.Cookie;
  }

  get current(): SessionTransport {
    return this.mode;
  }

  get usesCookies(): boolean {
    return this.mode === SessionTransport.Cookie;
  }

  /**
   * Steps down to header mode, and answers whether it did.
   *
   * The boolean is the caller's licence to retry. It is safe to retry because the refusal
   * comes from a guard that runs before the handler, so the request it refused did nothing:
   * no code was spent, no token rotated, no mail sent.
   */
  downgrade(): boolean {
    if (!this.negotiable || this.mode === SessionTransport.Header) return false;
    this.mode = SessionTransport.Header;
    if (!this.announced) {
      this.announced = true;
      this.announce(DOWNGRADE_NOTICE);
    }
    return true;
  }
}

/**
 * Said once, and worth saying, because the symptom is otherwise a mystery: everything works in
 * development, where loopback is same-site by accident, and sessions stop surviving a reload
 * the day the same code is deployed.
 */
const DOWNGRADE_NOTICE =
  "Idenzy: this API host cannot set first-party cookies for your site, so the session is held " +
  "in memory and will not survive a page reload. Point a subdomain of your own domain at " +
  "Idenzy (auth.yourdomain.com) to fix it, or pass a persistent refreshTokens store if you " +
  "accept the trade-off.";

function warnOnce(message: string): void {
  globalThis.console?.warn(message);
}
