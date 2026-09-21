import { MissingCredentialsError } from "@idenzy/core/errors";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import type { FastifyRequest } from "fastify";

/**
 * The two shapes of "who is asking" and how they relate.
 *
 * `TenantContext` is persistence's, and `FlowContext` is the domain's, which cannot
 * import persistence (PROJECT.md 8.3). They carry the same facts, so these two pure
 * functions are the seam. Keeping it explicit is cheaper than giving the domain a
 * dependency it is not allowed to have.
 */
export function flowContextFrom(request: FastifyRequest): FlowContext {
  const tenant = request.tenant;
  if (tenant === undefined) throw new MissingCredentialsError();
  return {
    projectId: tenant.projectId,
    requestId: tenant.requestId,
    ip: request.ip ?? null,
    userAgent: request.headers["user-agent"] ?? null,
    deviceName: deviceName(request.headers[IdenzyHeader.DeviceName]),
    locale: preferredLocale(request.headers["accept-language"]),
    attestation: attestation(request.headers[IdenzyHeader.Attestation]),
  };
}

export function tenantContextFrom(context: FlowContext): TenantContext {
  return new TenantContext(context.projectId, context.requestId, "user");
}

/**
 * The device label a client sent, or null, and never an error.
 *
 * Three things are deliberate. It is percent-decoded, because a header carries bytes and the
 * name is text in whatever language its owner speaks. A malformed escape falls back to the
 * raw value instead of throwing: a label is decoration on a list, and no sign-in may fail
 * over one. And control characters become whitespace, which is then collapsed, because this
 * string is written straight into a page the customer builds and a stray newline there is at
 * best a broken row.
 *
 * The 200 is `sessionSummarySchema`'s. Truncating here means the wire schema cannot reject a
 * row we already stored.
 */
function deviceName(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  const decoded = decode(header)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
    .replaceAll(/[\u0000-\u001F\u007F-\u009F]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return decoded.length === 0 ? null : decoded.slice(0, 200);
}

/**
 * The attestation token a client sent, or null.
 *
 * Taken raw and never decoded. Every provider issues these as URL-safe base64 already,
 * and a token is checked against the issuer's own copy: normalising it here could only
 * turn a valid token into one that fails to match. The cap is generous because App
 * Attest assertions are the long ones, and anything past it is not a token.
 */
function attestation(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  return trimmed.length === 0 || trimmed.length > 8192 ? null : trimmed;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The first tag from Accept-Language, ignoring the quality values.
 *
 * Deliberately shallow. Negotiating properly means knowing which locales the project has
 * translated, which is the renderer's fallback chain and not something a request parser
 * should duplicate. Taking the first preference and letting the chain resolve it gets
 * the same answer with one place to be wrong.
 */
function preferredLocale(header: string | undefined): string | null {
  const first = header?.split(",")[0]?.split(";")[0]?.trim();
  return first === undefined || first.length === 0 || first === "*" ? null : first;
}
