import { ErrorCode } from "@idenzy/protocol/errors/codes";

const CODES: ReadonlySet<string> = new Set(Object.values(ErrorCode));

/** Why a request produced no answer the SDK could use. */
export type TransportReason = "notSent" | "interrupted" | "unexpectedResponse";

/** Field-level detail on `validation_failed`, in the protocol's own shape. */
export interface FieldError {
  readonly path: string;
  readonly code: string;
}

interface Detail {
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly fields?: readonly FieldError[];
  readonly transportReason?: TransportReason;
}

/**
 * Everything the SDK throws, except a sign-in sheet the user closed.
 *
 * Branch on `code`, never on `message`: the codes are the API's stable contract and your screens
 * are built from them (Idenzy ships no authentication UI). A code newer than this build arrives as
 * `"unrecognized"` with `rawCode` beside it, because an app outlives the API it was built against.
 */
export class IdenzyError extends Error {
  readonly code: ErrorCode | "unrecognized";
  readonly rawCode: string;
  /** The HTTP status, or 0 when nothing came back at all. */
  readonly status: number;
  /** Quote this in a support request. Present when the API answered. */
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly fields: readonly FieldError[];
  readonly transportReason: TransportReason | null;

  constructor(rawCode: string, message: string, detail: Detail = {}) {
    super(message);
    this.name = "IdenzyError";
    this.rawCode = rawCode;
    this.code = CODES.has(rawCode) ? (rawCode as ErrorCode) : "unrecognized"; // checked against the set above
    this.status = detail.status ?? 0;
    this.requestId = detail.requestId ?? null;
    this.retryAfterSeconds = detail.retryAfterSeconds ?? null;
    this.fields = detail.fields ?? [];
    this.transportReason = detail.transportReason ?? null;
  }
}

/** The user closed a sign-in sheet or browser. What a cancel means is the screen's decision. */
export class IdenzySignInCancelled extends Error {
  constructor() {
    super("The sign-in was cancelled.");
    this.name = "IdenzySignInCancelled";
  }
}

/** A failure as the native module reports it, turned into the types above. */
export function errorFrom(code: string, message: string, details: Record<string, unknown>): Error {
  if (code === "cancelled") return new IdenzySignInCancelled();
  const reason = details["transportReason"];
  const fields = Array.isArray(details["fields"]) ? details["fields"] : [];
  return new IdenzyError(code, message, {
    ...(typeof details["status"] === "number" ? { status: details["status"] } : {}),
    ...(typeof details["requestId"] === "string" ? { requestId: details["requestId"] } : {}),
    ...(typeof details["retryAfterSeconds"] === "number"
      ? { retryAfterSeconds: details["retryAfterSeconds"] }
      : {}),
    fields: fields.flatMap((field: unknown) =>
      typeof field === "object" && field !== null
        ? [{ path: String(Reflect.get(field, "path")), code: String(Reflect.get(field, "code")) }]
        : [],
    ),
    ...(reason === "notSent" || reason === "interrupted" || reason === "unexpectedResponse"
      ? { transportReason: reason }
      : {}),
  });
}
