import { ValidationFailedError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { z } from "zod";

/** What a task carries: two identifiers, in the form the rest of the product prints them. */
const schema = z.object({
  delivery: z.string().min(1),
  project: z.string().min(1),
});

/**
 * The body of a retry task, which is an address and nothing else.
 *
 * No payload, no attempt number, no signature. The row is the truth about all three by the time the
 * task fires, and a task that carried its own copy would be a second opinion — the obvious failure
 * being a task that arrives twice and sends a body the delivery has since finished with.
 *
 * The ids travel in their public `dlv_`/`prj_` form rather than as raw uuids. That is deliberate: the
 * prefix is part of the identity, so a task naming a project where a delivery belongs fails to parse
 * here instead of addressing a row in another table, and the ids in the queue's own logs are the ones
 * the panel and our logs print.
 */
export class WebhookTaskBody {
  private constructor(
    readonly deliveryId: string,
    readonly projectId: string,
  ) {}

  /** From the uuids the pipeline holds. */
  static of(deliveryId: string, projectId: string): WebhookTaskBody {
    return new WebhookTaskBody(deliveryId, projectId);
  }

  /**
   * From the wire, where the body is whatever the caller sent.
   *
   * Authenticated does not mean well-formed: this is parsed like any other untrusted body
   * (PROJECT.md 7.1), and `PublicId.parse` is the half that matters because it is what refuses an id
   * of the wrong kind.
   */
  static parse(input: unknown): WebhookTaskBody {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationFailedError({
        message: "That task body is not a delivery.",
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      });
    }
    return new WebhookTaskBody(
      PublicId.parse(IdPrefix.Delivery, parsed.data.delivery).uuid,
      PublicId.parse(IdPrefix.Project, parsed.data.project).uuid,
    );
  }

  toJSON(): { readonly delivery: string; readonly project: string } {
    return {
      delivery: PublicId.encode(IdPrefix.Delivery, this.deliveryId).value,
      project: PublicId.encode(IdPrefix.Project, this.projectId).value,
    };
  }
}
