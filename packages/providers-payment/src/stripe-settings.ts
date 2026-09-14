import { ValidationFailedError } from "@idenzy/core/errors";

export interface StripeSettings {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly apiVersion: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

/** What the environment offers, before we know whether it offers all of it. */
export interface StripeEnvironment {
  readonly STRIPE_SECRET_KEY?: string | undefined;
  readonly STRIPE_WEBHOOK_SECRET?: string | undefined;
  readonly STRIPE_API_VERSION: string;
  readonly STRIPE_CHECKOUT_SUCCESS_URL?: string | undefined;
  readonly STRIPE_CHECKOUT_CANCEL_URL?: string | undefined;
}

const REQUIRED = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_CHECKOUT_SUCCESS_URL",
  "STRIPE_CHECKOUT_CANCEL_URL",
] as const;

/**
 * The four that travel together, or nothing.
 *
 * A deployment with none of them is correct and not degraded: it runs without a payment
 * provider, the wallet screen says so, and nothing offers to take a card. What must not
 * happen is a partial set, and the reason is sharper here than for the queue variables
 * that make the same call — without the webhook secret we can start a checkout and cannot
 * verify what comes back, which is a customer's card charged and no credit granted. Three
 * of four is a boot failure naming the one that is missing.
 *
 * `null` means "not configured" and is the caller's cue to build nothing. It is not an
 * error, which is why it is not thrown.
 */
export function stripeSettingsFrom(environment: StripeEnvironment): StripeSettings | null {
  const present = REQUIRED.filter((name) => {
    const value = environment[name];
    return value !== undefined && value.length > 0;
  });
  if (present.length === 0) return null;
  if (present.length < REQUIRED.length) {
    throw new ValidationFailedError({
      message: "The environment is not valid.",
      fields: REQUIRED.filter((name) => !present.includes(name)).map((name) => ({
        path: name,
        code: "required",
      })),
    });
  }
  return {
    secretKey: environment.STRIPE_SECRET_KEY ?? "",
    webhookSecret: environment.STRIPE_WEBHOOK_SECRET ?? "",
    apiVersion: environment.STRIPE_API_VERSION,
    successUrl: environment.STRIPE_CHECKOUT_SUCCESS_URL ?? "",
    cancelUrl: environment.STRIPE_CHECKOUT_CANCEL_URL ?? "",
  };
}
