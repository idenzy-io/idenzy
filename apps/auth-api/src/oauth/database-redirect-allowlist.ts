import type { RedirectAllowlist } from "@idenzy/domain/ports/oauth-provider";
import { RedirectUriRepository } from "@idenzy/persistence/repository/redirect-uri-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Injectable } from "@nestjs/common";
import { RedirectKind } from "../delivery/redirect-targets.js";

/**
 * The exact-match allowlist the OAuth base re-checks at the callback (PROJECT.md 4.6).
 *
 * Re-checking rather than trusting the value pinned at start is deliberate. The pinned
 * URI is where the browser is about to be sent, and a target the customer removed from
 * their allowlist in between has to stop working immediately rather than at the end of
 * the flow's ten-minute life.
 */
@Injectable()
export class DatabaseRedirectAllowlist implements RedirectAllowlist {
  constructor(private readonly uow: UnitOfWork) {}

  isAllowed(projectId: string, uri: string): Promise<boolean> {
    const tenant = new TenantContext(projectId, "oauth", "user");
    return this.uow.run(tenant, (tx) =>
      new RedirectUriRepository(tx, tenant).isAllowed(RedirectKind.Oauth, uri),
    );
  }
}
