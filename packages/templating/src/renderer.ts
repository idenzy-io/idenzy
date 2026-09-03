import { InternalError } from "@idenzy/core/errors";
import type { TemplateType } from "@idenzy/protocol/enums/delivery";
import { bind } from "./binding.js";
import { englishTemplates } from "./defaults/en.js";
import { localeChain } from "./locale.js";
import type { EmailTemplate, RenderedEmail, TemplateVariables } from "./template.js";

/**
 * Where a project's own templates come from.
 *
 * Abstract here and implemented against `email_templates` by the app, so this package
 * stays free of persistence (PROJECT.md 8.3) and the studio has one seam to write into.
 */
export abstract class TemplateStore {
  abstract find(
    projectId: string,
    type: TemplateType,
    locale: string,
  ): Promise<EmailTemplate | null>;
}

/** For deployments and tests where no project has customised anything yet. */
export class NoStoredTemplates extends TemplateStore {
  override find(): Promise<EmailTemplate | null> {
    return Promise.resolve(null);
  }
}

/**
 * Resolves a template and substitutes its variables.
 *
 * The resolution order is the part worth reading: the customer's whole fallback chain is
 * tried before any built-in. A project that has translated `en` and not `tr` should send
 * their English copy to a Turkish user, not ours, because their copy carries their
 * product's name and voice and ours carries neither.
 */
export class TemplateRenderer {
  constructor(private readonly store: TemplateStore) {}

  async render(
    projectId: string,
    type: TemplateType,
    locale: string,
    variables: TemplateVariables,
  ): Promise<RenderedEmail> {
    const chain = localeChain(locale);
    const template = (await this.findStored(projectId, type, chain)) ?? builtIn(type, chain);
    return {
      subject: bind(template.subject, variables, "text"),
      html: bind(template.html, variables, "html"),
      text: bind(template.text, variables, "text"),
      locale: template.locale,
    };
  }

  private async findStored(
    projectId: string,
    type: TemplateType,
    chain: readonly string[],
  ): Promise<EmailTemplate | null> {
    for (const locale of chain) {
      const found = await this.store.find(projectId, type, locale);
      if (found !== null) return found;
    }
    return null;
  }
}

function builtIn(type: TemplateType, chain: readonly string[]): EmailTemplate {
  const template = englishTemplates.get(type);
  if (template === undefined) {
    throw new InternalError({
      detail: { reason: "no built-in template for this type", type, chain: [...chain] },
    });
  }
  return template;
}
