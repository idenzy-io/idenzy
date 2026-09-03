import { InternalError } from "@idenzy/core/errors";
import type { TemplateType } from "@idenzy/protocol/enums/delivery";
import { bind } from "./binding.js";
import { englishSmsTemplates } from "./defaults/sms-en.js";
import { localeChain } from "./locale.js";
import { measure, type SmsLength } from "./segments.js";
import type { SmsTemplate, TemplateVariables } from "./template.js";

export interface RenderedSms {
  readonly body: string;
  /** Which locale actually supplied the copy, after the fallback chain resolved. */
  readonly locale: string;
  readonly length: SmsLength;
}

/**
 * Where a project's own SMS copy comes from.
 *
 * Abstract for the same reason the email one is, and unimplemented for now: customer
 * authoring arrives with the studio, and until then every project sends the built-ins.
 */
export abstract class SmsTemplateStore {
  abstract find(projectId: string, type: TemplateType, locale: string): Promise<SmsTemplate | null>;
}

/** The store every deployment uses until the studio exists. */
export class NoStoredSmsTemplates extends SmsTemplateStore {
  override find(): Promise<SmsTemplate | null> {
    return Promise.resolve(null);
  }
}

export interface SmsRenderOptions {
  /**
   * The eleven-character app hash Android's SMS Retriever matches on.
   *
   * Appended rather than templated, because the format is a platform contract: the
   * message has to open with `<#>` and close with the hash on its own line, and a
   * customer editing copy would eventually break one half of that and lose autofill with
   * no error anywhere. Null for a project that has not registered one.
   */
  readonly retrieverHash?: string | null;
}

/**
 * Resolves an SMS template, substitutes its variables and prices the result.
 *
 * Same resolution order as email: the customer's whole fallback chain before any
 * built-in, so a project that has translated `en` and not `tr` sends their English copy
 * rather than ours (PROJECT.md 11.3).
 *
 * The length comes back with the body because the caller meters it. An SMS is billed by
 * segment, and the place that knows how many segments there are is the place that just
 * assembled the string.
 */
export class SmsRenderer {
  constructor(private readonly store: SmsTemplateStore) {}

  async render(
    projectId: string,
    type: TemplateType,
    locale: string,
    variables: TemplateVariables,
    options: SmsRenderOptions = {},
  ): Promise<RenderedSms> {
    const chain = localeChain(locale);
    const template = (await this.findStored(projectId, type, chain)) ?? builtIn(type, chain);
    const bound = bind(template.body, variables, "text");
    const body = withRetrieverHash(bound, options.retrieverHash ?? null);
    return { body, locale: template.locale, length: measure(body) };
  }

  private async findStored(
    projectId: string,
    type: TemplateType,
    chain: readonly string[],
  ): Promise<SmsTemplate | null> {
    for (const locale of chain) {
      const found = await this.store.find(projectId, type, locale);
      if (found !== null) return found;
    }
    return null;
  }
}

/** Google's format: `<#>` opens the message and the hash closes it on its own line. */
function withRetrieverHash(body: string, hash: string | null): string {
  if (hash === null || hash === "") return body;
  return `<#> ${body}\n${hash}`;
}

function builtIn(type: TemplateType, chain: readonly string[]): SmsTemplate {
  const template = englishSmsTemplates.get(type);
  if (template === undefined) {
    throw new InternalError({
      detail: { reason: "no built-in sms template for this type", type, chain: [...chain] },
    });
  }
  return template;
}
