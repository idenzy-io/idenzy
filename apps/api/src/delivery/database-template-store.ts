import { EmailTemplateRepository } from "@idenzy/persistence/repository/email-template-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { TemplateType } from "@idenzy/protocol/enums/delivery";
import { TemplateStore } from "@idenzy/templating/renderer";
import type { EmailTemplate } from "@idenzy/templating/template";
import { Injectable } from "@nestjs/common";

/**
 * A project's own templates, read from `email_templates`.
 *
 * A row whose compiled `html` is missing counts as absent rather than as an empty mail:
 * compilation happens off the request path and a row that has not been through it yet is
 * not something to send (PROJECT.md 11.3).
 */
@Injectable()
export class DatabaseTemplateStore extends TemplateStore {
  constructor(private readonly uow: UnitOfWork) {
    super();
  }

  override async find(
    projectId: string,
    type: TemplateType,
    locale: string,
  ): Promise<EmailTemplate | null> {
    const tenant = new TenantContext(projectId, "delivery", "system");
    const row = await this.uow.transaction((tx) =>
      new EmailTemplateRepository(tx, tenant).find(type, locale),
    );
    if (row === null || row.html === null || row.text === null) return null;
    return {
      type,
      locale: row.locale,
      subject: row.subject,
      html: row.html,
      text: row.text,
    };
  }
}
