import { IdenzyError } from "@idenzy/core/errors/idenzy-error";
import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { errorBodySchema } from "@idenzy/protocol/errors/contract";

export interface IdenzyAdminOptions {
  /** The auth API's base URL, the same one the verifier takes as `issuerUrl`. */
  readonly baseUrl: string;
  /**
   * The project's secret key.
   *
   * Server-side only, like the revocation cache's: whatever holds it can erase the project's
   * users, which is the reason a browser never gets one.
   */
  readonly secretKey: string;
  /** For tests and for a deployment that routes outbound calls through its own client. */
  readonly fetch?: typeof globalThis.fetch;
}

/** What a deletion found: the account erased now, or no live account by that id. */
export type UserDeletion = "deleted" | "not_found";

/** A refusal from the API, with the code and request id it answered with. */
export class IdenzyAdminError extends IdenzyError {
  override readonly code: ErrorCode;
  override readonly status: number;
  /** Quote this to support. Null when the answer did not carry one. */
  readonly requestId: string | null;

  constructor(code: ErrorCode, status: number, message: string, requestId: string | null) {
    super(message);
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

/**
 * The project's own users, from the customer's backend, with the secret key.
 *
 * `users.delete` is the call a product makes when one of its users deletes their account. It
 * erases them at once: the account is tombstoned, every way back in and every session goes, an
 * access token already issued is revoked through the published set, and the project's webhooks
 * get `user.deleted`. The same person signing in again later starts a new account.
 *
 * "not_found" covers an id that never existed and one already erased, on purpose: a retry after
 * a lost response must read as done, and the API does not confirm that somebody once existed.
 */
export class IdenzyAdmin {
  readonly users: { delete(userId: string): Promise<UserDeletion> };
  private readonly base: string;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: IdenzyAdminOptions) {
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.request = options.fetch ?? globalThis.fetch;
    this.users = { delete: (userId) => this.deleteUser(userId) };
  }

  private async deleteUser(userId: string): Promise<UserDeletion> {
    const response = await this.request(`${this.base}/v1/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.options.secretKey}` },
    });
    if (response.status === 204) return "deleted";
    if (response.status === 404) return "not_found";
    throw refusal(response.status, await response.text());
  }
}

function refusal(status: number, body: string): IdenzyAdminError {
  const parsed = errorBodySchema.safeParse(readJson(body));
  if (!parsed.success) {
    return new IdenzyAdminError(
      ErrorCode.ProviderUnavailable,
      status,
      `The API answered ${String(status)} with an unrecognised body.`,
      null,
    );
  }
  const { code, message, requestId } = parsed.data.error;
  return new IdenzyAdminError(code, status, message, requestId);
}

function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
