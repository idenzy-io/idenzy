import { ProviderUnavailableError } from "@idenzy/core/errors";
import type { Clock } from "@idenzy/core/time/clock";
import type { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import type { SendContext, SmsProvider } from "@idenzy/domain/ports/sms-provider";

/** Where a country's traffic goes, in preference order. `country` is ISO 3166-1 alpha-2. */
export interface RoutingRule {
  readonly country: string;
  readonly providers: readonly string[];
}

export interface RouterOptions {
  /** Consecutive failures before a provider is taken out of rotation. */
  readonly failureThreshold: number;
  /** How long it stays out. One cooldown, then one request is allowed through to probe. */
  readonly cooldownSeconds: number;
}

const DEFAULTS: RouterOptions = { failureThreshold: 3, cooldownSeconds: 60 };

interface Health {
  consecutiveFailures: number;
  openedAt: number | null;
}

/**
 * Picks which provider carries a message, and takes a failing one out of rotation
 * (PROJECT.md 11.1).
 *
 * Two decisions in here are worth more than the code.
 *
 * **It does not retry.** A dispatch that failed has already reserved the spend and
 * already spent the number's velocity allowance, and it cannot know whether the message
 * went out before the error: a timeout from an SMS gateway is the case where it usually
 * did. Retrying on a second provider bills twice and delivers two codes, so failover
 * happens on the *next* request instead. Same reasoning as never retrying a refresh.
 *
 * **Cheapest is the order of the table, not a quote per send.** Asking three providers
 * to price every message is three network calls on the request path to choose between
 * fractions of a cent. The operator orders each country's list by price; the router only
 * skips what is unhealthy.
 */
export class ProviderRouter {
  private readonly byId: ReadonlyMap<string, SmsProvider>;
  private readonly health = new Map<string, Health>();
  private readonly options: RouterOptions;

  constructor(
    providers: readonly SmsProvider[],
    private readonly rules: readonly RoutingRule[],
    private readonly clock: Clock,
    options: Partial<RouterOptions> = {},
  ) {
    this.byId = new Map(providers.map((provider) => [provider.id, provider]));
    this.options = { ...DEFAULTS, ...options };
  }

  /**
   * Sends through the first healthy provider for the destination.
   *
   * `country` comes from the caller because the fraud guard has already placed the
   * number and placing it twice would parse it twice.
   */
  async send(
    context: SendContext,
    to: E164PhoneNumber,
    body: string,
    senderId: string,
    country: string | null,
  ): Promise<string> {
    const provider = this.select(country);
    try {
      const messageId = await provider.send(context, to, body, senderId);
      this.health.delete(provider.id);
      return messageId;
    } catch (error: unknown) {
      this.recordFailure(provider.id);
      throw error;
    }
  }

  /** The provider a destination would use right now. Exposed for health endpoints. */
  select(country: string | null): SmsProvider {
    const preferred = this.preferenceFor(country);
    for (const id of preferred) {
      const provider = this.byId.get(id);
      if (provider !== undefined && this.isHealthy(id)) return provider;
    }
    // Everything for this country is in cooldown. Refusing is right: the alternative is
    // routing to a provider we know is failing, which loses the message and the money.
    throw new ProviderUnavailableError({
      detail: { country: country ?? "unknown", tried: [...preferred] },
    });
  }

  private preferenceFor(country: string | null): readonly string[] {
    const match = country === null ? undefined : this.rules.find((r) => r.country === country);
    const fallback = this.rules.find((r) => r.country === "*");
    return match?.providers ?? fallback?.providers ?? [];
  }

  /**
   * A provider is healthy until it fails `failureThreshold` times in a row, and healthy
   * again one cooldown later. The counter resets on any success, so an intermittent
   * failure never accumulates its way to an outage.
   */
  private isHealthy(id: string): boolean {
    const health = this.health.get(id);
    if (health === undefined || health.openedAt === null) return true;
    if (this.clock.nowMs() - health.openedAt < this.options.cooldownSeconds * 1000) return false;
    // The cooldown is over. Let one request through and judge the provider on it.
    this.health.set(id, { consecutiveFailures: this.options.failureThreshold - 1, openedAt: null });
    return true;
  }

  private recordFailure(id: string): void {
    const current = this.health.get(id) ?? { consecutiveFailures: 0, openedAt: null };
    const consecutiveFailures = current.consecutiveFailures + 1;
    this.health.set(id, {
      consecutiveFailures,
      openedAt: consecutiveFailures >= this.options.failureThreshold ? this.clock.nowMs() : null,
    });
  }
}
