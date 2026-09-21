import { ValidationFailedError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { ClaimTemplateRepository } from "@idenzy/persistence/repository/claim-template-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  type ClaimTemplateInput,
  claimMappingSchema,
  claimTemplateSchema,
  MAX_CLAIM_BYTES,
  RESERVED_CLAIMS,
  type SavedClaimTemplate,
} from "@idenzy/protocol/schemas/claims";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/**
 * A project's claim template, for the panel's Claims screen (PROJECT.md 4.2).
 *
 * The rules are the same four the auth API enforces on its own secret-key route, and they
 * are restated here rather than shared because the two services do not share a process and
 * `@idenzy/protocol` is where the shape lives, not the behaviour. Keeping them in step
 * matters more than avoiding the repetition: a template the dashboard accepts and the
 * issuer refuses is a project whose tokens stop being minted, discovered at sign-in.
 *
 * The reserved names are the protocol's own list for exactly that reason — a dashboard and
 * an issuer that disagreed about whether `sub` may be overwritten would be the worst
 * possible place for a disagreement.
 */
@Injectable()
export class ClaimsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
    private readonly clock: Clock,
  ) {}

  async read(context: OrgContext, projectId: string): Promise<SavedClaimTemplate> {
    const tenant = await this.scope.of(context, projectId);
    return await this.load(tenant);
  }

  async save(
    context: OrgContext,
    projectId: string,
    input: ClaimTemplateInput,
  ): Promise<SavedClaimTemplate> {
    const tenant = await this.scope.of(context, projectId);
    const template = claimTemplateSchema.parse(input);

    assertDistinct(template.claims.map((claim) => claim.name));
    assertAcknowledged(template);
    assertWithinBudget(template.claims.map((claim) => claim.name));

    // Stamped only when a claim actually reads private metadata, so the record says when
    // the acknowledgement was given rather than that a box was once ticked.
    const acknowledgedAt = template.claims.some((claim) => claim.source === "metadata_private")
      ? this.clock.now()
      : null;

    const updatedAt = await this.uow.transaction((tx) =>
      new ClaimTemplateRepository(tx, tenant).save(template.claims, acknowledgedAt),
    );
    return {
      claims: template.claims,
      // Derived from what was stored, not echoed from what was sent. A template that no
      // longer reads private metadata has no acknowledgement — `acknowledgedAt` is null in
      // that case — and returning the caller's `true` would leave the screen showing a
      // consent the record does not hold, which the next read would then contradict.
      acknowledgePrivateMetadata: acknowledgedAt !== null,
      updatedAt: updatedAt.toISOString(),
    };
  }

  private async load(tenant: TenantContext): Promise<SavedClaimTemplate> {
    const row = await this.uow.transaction((tx) => new ClaimTemplateRepository(tx, tenant).find());
    if (row === null) {
      // A project that has never saved one has an empty template, not a missing resource:
      // the screen opens on it and adds the first claim.
      return {
        claims: [],
        acknowledgePrivateMetadata: false,
        updatedAt: new Date(0).toISOString(),
      };
    }
    const parsed = claimMappingSchema.array().safeParse(row.claims);
    return {
      claims: parsed.success ? parsed.data : [],
      acknowledgePrivateMetadata: row.privateMetadataAcknowledgedAt !== null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * A refusal the customer can act on.
 *
 * `ValidationFailedError` and never a raw `ZodError`: one escaping a service reaches the
 * exception filter as an unrecognised throw and becomes a 500, so a customer saving a
 * template with two claims of one name is told the server broke rather than which claim it
 * was. The auth API's own service documents this exact trap, and this file reproduced it —
 * found by calling the route rather than by reading it.
 */
function fail(path: (string | number)[], message: string): never {
  throw new ValidationFailedError({
    message,
    fields: [{ path: path.join("."), code: "custom" }],
  });
}

/** Two claims of one name is one claim and a silently discarded one. */
function assertDistinct(names: readonly string[]): void {
  const seen = new Set<string>();
  names.forEach((name, index) => {
    if (seen.has(name)) fail(["claims", index, "name"], `${name} is named twice`);
    seen.add(name);
  });
  const reserved = names.find((name) => (RESERVED_CLAIMS as readonly string[]).includes(name));
  if (reserved !== undefined) {
    fail(["claims"], `${reserved} is reserved and cannot be overwritten`);
  }
}

/**
 * Private metadata is the one source that needs saying out loud.
 *
 * Everything else a template can read is already in the profile the SDK returns; this is
 * the customer's own private bag, and putting it in a token publishes it to every verifier
 * they have. A claim that reads it without the acknowledgement is refused rather than
 * quietly dropped, because dropping it is a template that does not do what it says.
 */
function assertAcknowledged(template: {
  claims: readonly { source: string }[];
  acknowledgePrivateMetadata: boolean;
}): void {
  const readsPrivate = template.claims.some((claim) => claim.source === "metadata_private");
  if (readsPrivate && !template.acknowledgePrivateMetadata) {
    fail(["acknowledgePrivateMetadata"], "reading private metadata has to be acknowledged");
  }
}

/**
 * The names alone, against the byte budget.
 *
 * A save sees only names; a render is the first thing that sees a value, and the issuer
 * caps there too. Checking here as well is what stops a template being saved that can never
 * mint a token — which the customer would discover at their users' next sign-in.
 */
function assertWithinBudget(names: readonly string[]): void {
  const bytes = names.reduce((total, name) => total + Buffer.byteLength(name, "utf8") + 8, 0);
  if (bytes > MAX_CLAIM_BYTES) {
    fail(["claims"], `the claim names alone exceed ${String(MAX_CLAIM_BYTES)} bytes`);
  }
}
