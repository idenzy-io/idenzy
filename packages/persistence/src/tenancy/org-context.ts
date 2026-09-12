/**
 * Who is asking, on behalf of which organisation (ADR-0011).
 *
 * The control-plane counterpart of {@link TenantContext}. An organisation holds the
 * team, the wallet and the invoices; a project holds the sign-in rules and the meters.
 * Two keys because they are two boundaries, and a context carrying both would let a
 * repository filter on whichever one it happened to reach for.
 */
export class OrgContext {
  constructor(
    readonly orgId: string,
    readonly requestId: string,
    readonly actorType: string,
    readonly actorId: string | null = null,
    readonly traceId: string | null = null,
  ) {}

  /** Fields safe to attach to every log line for this request (PROJECT.md 4.13.8). */
  toLogFields(): Readonly<Record<string, unknown>> {
    return {
      orgId: this.orgId,
      requestId: this.requestId,
      actorType: this.actorType,
      ...(this.traceId === null ? {} : { traceId: this.traceId }),
    };
  }
}
