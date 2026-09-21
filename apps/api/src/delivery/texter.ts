import { InternalError } from "@idenzy/core/errors";
import type { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import type { PhoneGeography, SendContext } from "@idenzy/domain/ports/sms-provider";
import { ProjectRepository } from "@idenzy/persistence/repository/project-repository";
import { SmsPolicyRepository } from "@idenzy/persistence/repository/sms-policy-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { TemplateType } from "@idenzy/protocol/enums/delivery";
import { ProviderRouter } from "@idenzy/providers-sms/provider-router";
import { SmsRenderer } from "@idenzy/templating/sms-renderer";
import { Inject, Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { PHONE_GEOGRAPHY } from "./delivery-tokens.js";

/** What a flow supplies. `project.name` is filled in here. */
export interface TextVariables {
  readonly otp?: string;
  readonly expiresInSeconds: number;
}

/** The sender id a project falls back to when it has registered none of its own. */
const DEFAULT_SENDER_ID = "Idenzy";

/**
 * Renders a transactional SMS and hands it to whichever provider carries that country.
 *
 * The seam every flow sends through, so no flow assembles copy or reaches for a sender
 * id, exactly as `Mailer` is for email. It places the number once and passes the country
 * to the router, because the fraud guard is about to place it too and parsing a number
 * twice per send is the kind of cost that only looks small.
 */
@Injectable()
export class Texter {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly renderer: SmsRenderer,
    private readonly router: ProviderRouter,
    @Inject(PHONE_GEOGRAPHY) private readonly geography: PhoneGeography,
  ) {}

  async deliver(
    context: FlowContext,
    type: TemplateType,
    to: E164PhoneNumber,
    variables: TextVariables,
  ): Promise<void> {
    const tenant = tenantContextFrom(context);
    const { project, policy } = await this.uow.transaction(async (tx) => ({
      project: await new ProjectRepository(tx, tenant).current(),
      policy: await new SmsPolicyRepository(tx, tenant).current(),
    }));
    if (project === null) {
      throw new InternalError({
        detail: { reason: "a request resolved to a project that cannot be read back" },
      });
    }

    const { expiresInSeconds, ...supplied } = variables;
    const rendered = await this.renderer.render(context.projectId, type, context.locale ?? "", {
      ...supplied,
      project: { name: project.name },
      expires_in: humanize(expiresInSeconds),
    });

    const send: SendContext = {
      projectId: context.projectId,
      requestId: context.requestId,
      ip: context.ip,
      attestation: context.attestation,
    };
    await this.router.send(
      send,
      to,
      rendered.body,
      policy?.senderId ?? DEFAULT_SENDER_ID,
      this.geography.place(to).country,
    );
  }
}

/**
 * "10 minutes", "24 hours". The same shape the mailer uses, because the two messages say
 * the same thing to the same person and reading differently would be the surprise.
 */
function humanize(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
