import type { DsrKind } from "@idenzy/protocol/enums/compliance";

export interface DsrContext {
  readonly projectId: string;
  readonly requestId: string;
  readonly subjectUserId: string;
}

export interface DsrResult {
  readonly kind: DsrKind;
  /** Where the export bundle landed, for access and portability requests. */
  readonly artifactUri: string | null;
  readonly affectedTables: readonly string[];
}

/**
 * Executes one kind of data-subject request (PROJECT.md 4.13.6).
 *
 * Implementations read the field lists generated from the schema classification rather
 * than hard-coding column names, which is what stops the most common GDPR Art.15
 * failure: an export that quietly omits a column somebody added two years ago.
 *
 * The base records completion, so a handler cannot do the work and leave the request
 * looking overdue.
 */
export abstract class DataSubjectRequestHandler {
  abstract readonly kind: DsrKind;
  protected abstract execute(context: DsrContext): Promise<DsrResult>;
  protected abstract markCompleted(context: DsrContext, result: DsrResult): Promise<void>;

  async handle(context: DsrContext): Promise<DsrResult> {
    const result = await this.execute(context);
    await this.markCompleted(context, result);
    return result;
  }
}
