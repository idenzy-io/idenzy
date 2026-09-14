import { InternalError } from "@idenzy/core/errors";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { EmailProvider } from "@idenzy/domain/ports/email-provider";
import { ProjectRepository } from "@idenzy/persistence/repository/project-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { TemplateType } from "@idenzy/protocol/enums/delivery";
import { TemplateRenderer } from "@idenzy/templating/renderer";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { SendingDomains } from "./sending-domains.js";

/**
 * What a flow supplies. `project.name` and `user.email` are filled in here.
 *
 * `expiresInSeconds` is optional because not every mail is an invitation with a clock on
 * it: `password_changed` reports something that already happened. Omitting it leaves
 * `expires_in` out of scope entirely rather than binding it to zero, which matters
 * because substitution fails closed — a template that names a variable nothing supplies
 * is a render error, and that is the check that catches a typo before a user does.
 */
export interface MailVariables {
  readonly otp?: string;
  readonly link?: string;
  readonly new_email?: string;
  readonly expiresInSeconds?: number;
}

/**
 * Renders a transactional mail and hands it to the provider.
 *
 * The seam every flow sends through, so no flow assembles a subject line or reaches for
 * the sending address, and so the project's own templates are consulted the same way
 * every time. A flow says which template and which variables; everything about how a
 * mail is built lives here.
 */
@Injectable()
export class Mailer {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly renderer: TemplateRenderer,
    private readonly provider: EmailProvider,
    private readonly domains: SendingDomains,
  ) {}

  async deliver(
    context: FlowContext,
    type: TemplateType,
    to: string,
    variables: MailVariables,
  ): Promise<void> {
    const tenant = tenantContextFrom(context);
    const project = await this.uow.run(tenant, (tx) => new ProjectRepository(tx, tenant).current());
    if (project === null) {
      throw new InternalError({
        detail: { reason: "a request resolved to a project that cannot be read back" },
      });
    }

    const { expiresInSeconds, ...supplied } = variables;
    const rendered = await this.renderer.render(context.projectId, type, context.locale ?? "", {
      ...supplied,
      project: { name: project.name },
      user: { email: to },
      ...(expiresInSeconds === undefined ? {} : { expires_in: humanize(expiresInSeconds) }),
    });

    // The project's own verified domain where it has one, and the shared sender where it
    // does not. This used to be one address from the environment for every project on the
    // deployment, which meant a customer paying for a sending domain had it collected,
    // verified, displayed on a screen and never used (PROJECT.md 11.2).
    const identity = await this.domains.forProject(context.projectId);
    await this.provider.send(context.projectId, {
      to,
      from: identity.from,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }
}

/**
 * "10 minutes", "24 hours". Rounded, because the copy says roughly how long a code lasts
 * and a user reading "9 minutes 58 seconds" learns nothing they can act on.
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
