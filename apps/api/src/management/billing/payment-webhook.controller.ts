import { ValidationFailedError } from "@idenzy/core/errors";
import { Body, Controller, Headers, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PaymentWebhookService } from "./payment-webhook-service.js";

const PAYMENT_WEBHOOK_PATH = "v1/payments/stripe/webhook";

/**
 * Nest writes this when the application is created with `rawBody`, and declares it on its
 * own request type rather than on Fastify's — which is the one the `@Req()` parameter has.
 */
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/**
 * Where the payment provider tells us what happened (PROJECT.md 5.1).
 *
 * **No session, no membership, no CORS.** This is the one route on the service a browser
 * never calls: the caller is Stripe, and what authenticates it is the signature over the
 * body rather than anything about who is asking. It carries no `@RequireRole`, which is
 * what makes `MembershipGuard` let it past — the guard is opt-in and a route with neither
 * decorator resolves no membership, so nothing downstream can reach for an org context it
 * was never given.
 *
 * **It answers 200 to almost everything, and that is deliberate.** A provider retries what
 * it reads as a failure, so a 500 on an event we do not handle would have Stripe deliver it
 * for days. What we cannot verify is a 400 — that is not a retry, it is a forgery or a
 * misconfiguration, and neither improves by being sent again.
 */
@Controller()
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post(PAYMENT_WEBHOOK_PATH)
  @HttpCode(200)
  async receive(
    @Req() request: FastifyRequest,
    @Headers("stripe-signature") signature: string | undefined,
    @Body() _body: unknown,
  ): Promise<{ received: boolean }> {
    // Nest keeps this when the app is created with `rawBody`, as a Buffer. The signature
    // covers these bytes and not a re-serialised copy of the object beside them.
    const raw = request.rawBody?.toString("utf8");
    if (raw === undefined || signature === undefined || signature.length === 0) {
      throw new ValidationFailedError({
        message: "That webhook could not be read.",
        fields: [{ path: "stripe-signature", code: "required" }],
      });
    }
    await this.webhooks.receive(raw, signature, String(request.id));
    return { received: true };
  }
}
