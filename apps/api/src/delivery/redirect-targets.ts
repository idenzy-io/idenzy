import { RedirectUriNotAllowedError } from "@idenzy/core/errors";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { RedirectUriRepository } from "@idenzy/persistence/repository/redirect-uri-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/** Allowlist kinds. A URI registered for one purpose never serves another. */
export const RedirectKind = {
  MagicLink: "magic_link",
  Oauth: "oauth",
  PasswordReset: "password_reset",
  EmailVerification: "email_verification",
  EmailChange: "email_change",
} as const;
export type RedirectKind = (typeof RedirectKind)[keyof typeof RedirectKind];

/**
 * Where a mailed link should land, given that we render no page (PROJECT.md 1.1).
 *
 * A reset mail has to point at the customer's own reset form, so the project registers
 * that URI and we read it here rather than taking one from the request. That is the
 * difference between a link we vouch for and an open redirect: the caller does not get
 * to choose.
 *
 * A project with nothing registered is a configuration error, and it is surfaced as one
 * rather than quietly falling back to a page of ours, because there is no page of ours.
 */
@Injectable()
export class RedirectTargets {
  constructor(private readonly uow: UnitOfWork) {}

  async forKind(context: FlowContext, kind: RedirectKind): Promise<string> {
    const tenant = tenantContextFrom(context);
    const registered = await this.uow.transaction((tx) =>
      new RedirectUriRepository(tx, tenant).list(kind),
    );
    const first = registered[0];
    if (first === undefined) {
      throw new RedirectUriNotAllowedError({
        message: "This project has no registered URI for that link.",
        detail: { kind },
      });
    }
    return first;
  }

  /** Appends the single-use token the customer's route posts back to us. */
  static withToken(uri: string, token: string): string {
    const url = new URL(uri);
    url.searchParams.set("token", token);
    return url.toString();
  }
}
