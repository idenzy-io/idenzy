import { DisputeStatus, RefundState } from "@idenzy/protocol/enums/billing";
import { z } from "zod";

/**
 * The parts of Stripe's objects the payment webhook acts on, parsed before anything reads them
 * (PROJECT.md 7.1).
 *
 * The signature proves Stripe sent the body; it does not prove the body has the shape this code
 * expects under the API version we pinned. Each schema names only the fields that decide
 * something and lets the rest through, so a field Stripe adds next year changes nothing and a
 * field it removes fails here, loudly, instead of reading as `undefined` three calls later.
 *
 * Amounts are integers in the currency's smallest unit, which for every currency we sell in is
 * cents — the same unit the ledger uses.
 */

const intentId = z.string().startsWith("pi_");
const cents = z.number().int().nonnegative();

/** `refund.created`, `refund.updated`, `refund.failed` and `charge.refund.updated`. */
export const stripeRefundSchema = z.object({
  id: z.string().startsWith("re_"),
  amount: cents,
  status: z.enum([
    RefundState.Pending,
    RefundState.RequiresAction,
    RefundState.Succeeded,
    RefundState.Failed,
    RefundState.Canceled,
  ]),
  // Null for a refund of a charge made without an intent, which none of ours are.
  payment_intent: intentId.nullable(),
});
export type StripeRefund = z.infer<typeof stripeRefundSchema>;

/** Every `charge.dispute.*` event carries the dispute. */
export const stripeDisputeSchema = z.object({
  id: z.string().startsWith("dp_").or(z.string().startsWith("du_")),
  amount: cents,
  status: z.enum([
    DisputeStatus.WarningNeedsResponse,
    DisputeStatus.WarningUnderReview,
    DisputeStatus.WarningClosed,
    DisputeStatus.NeedsResponse,
    DisputeStatus.UnderReview,
    DisputeStatus.Won,
    DisputeStatus.Lost,
    DisputeStatus.Prevented,
  ]),
  reason: z.string().default(""),
  payment_intent: intentId.nullable(),
});
export type StripeDispute = z.infer<typeof stripeDisputeSchema>;

/** `review.closed`: a Radar review of a payment, and why it ended. */
export const stripeReviewSchema = z.object({
  reason: z.string(),
  payment_intent: intentId.nullable().optional(),
});
export type StripeReview = z.infer<typeof stripeReviewSchema>;

/** `payment_intent.*`: the handle, and the decline code where there was one. */
export const stripeIntentSchema = z.object({
  id: intentId,
  last_payment_error: z.object({ code: z.string().optional() }).nullable().optional(),
});
export type StripeIntent = z.infer<typeof stripeIntentSchema>;

/** `invoice.*`: an invoice we issued, carrying our row id and organisation in its metadata. */
export const stripeInvoiceSchema = z.object({
  id: z.string().startsWith("in_"),
  status: z.string().nullable(),
  hosted_invoice_url: z.string().nullable().optional(),
  invoice_pdf: z.string().nullable().optional(),
  created: z.number().int(),
  due_date: z.number().int().nullable().optional(),
  status_transitions: z
    .object({
      finalized_at: z.number().int().nullable().optional(),
      paid_at: z.number().int().nullable().optional(),
    })
    .optional(),
});
export type StripeInvoice = z.infer<typeof stripeInvoiceSchema>;

/** `customer.*`: only the id is acted on; the organisation comes from our metadata on it. */
export const stripeCustomerSchema = z.object({ id: z.string().startsWith("cus_") });
