import type { TemplateType } from "@idenzy/protocol/enums/delivery";
import { and, eq } from "drizzle-orm";
import { emailTemplates } from "../schema/messaging.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface StoredTemplateRow {
  readonly type: string;
  readonly locale: string;
  readonly subject: string;
  readonly html: string | null;
  readonly text: string | null;
}

/**
 * A project's own transactional templates (PROJECT.md 11.3).
 *
 * Reads the compiled `html` rather than the `mjml` source, because compilation is
 * CPU-bound work that belongs on the worker pool with the result cached by version, not
 * on the path of every sign-in. A row with no compiled body has not been through that
 * step yet, and the renderer treats it as absent rather than sending an empty mail.
 */
export class EmailTemplateRepository extends BaseRepository<typeof emailTemplates> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, emailTemplates);
  }

  async find(type: TemplateType, locale: string): Promise<StoredTemplateRow | null> {
    const rows = await this.tx
      .select({
        type: emailTemplates.type,
        locale: emailTemplates.locale,
        subject: emailTemplates.subject,
        html: emailTemplates.html,
        text: emailTemplates.text,
      })
      .from(emailTemplates)
      .where(
        and(this.tenantScope(), eq(emailTemplates.type, type), eq(emailTemplates.locale, locale)),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
