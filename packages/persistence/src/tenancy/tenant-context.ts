/**
 * Who is asking, on behalf of which tenant (PROJECT.md 9.4).
 *
 * Request-scoped and required to build a repository, which is what makes the tenant
 * filter structural instead of a convention someone can forget.
 */
export class TenantContext {
  constructor(
    readonly projectId: string,
    readonly requestId: string,
    readonly actorType: string,
    readonly actorId: string | null = null,
    readonly traceId: string | null = null,
  ) {}

  /** Fields safe to attach to every log line for this request (PROJECT.md 4.13.8). */
  toLogFields(): Readonly<Record<string, unknown>> {
    return {
      projectId: this.projectId,
      requestId: this.requestId,
      actorType: this.actorType,
      ...(this.traceId === null ? {} : { traceId: this.traceId }),
    };
  }
}
