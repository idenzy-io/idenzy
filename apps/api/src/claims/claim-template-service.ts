import { ValidationFailedError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { ClaimTemplate } from "@idenzy/domain/policies/claim-template";
import { ClaimTemplateRepository } from "@idenzy/persistence/repository/claim-template-repository";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  type ClaimMapping,
  ClaimSource,
  type ClaimTemplateInput,
  claimMappingSchema,
  claimTemplateSchema,
  MAX_CLAIM_BYTES,
  type SavedClaimTemplate,
} from "@idenzy/protocol/schemas/claims";
import { Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";

/**
 * Reading and saving a project's claim template (PROJECT.md 4.2).
 *
 * The two rules that cannot live in the schema are here. A template that reads
 * `metadata_private` needs somebody to say out loud that it does, and the names alone
 * have to fit inside what a token may carry before any value is considered.
 *
 * Everything else is `claimTemplateSchema`: the reserved names, the claimable user fields
 * and the count are declared in `@idenzy/protocol` precisely so a dashboard checks the
 * same list this does.
 */
@Injectable()
export class ClaimTemplateService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  /**
   * The template for the current tenant, ready to render.
   *
   * A project with no row gets an empty template rather than an error: configuring none
   * is the default, and it must never be the reason a sign-in fails. A row whose stored
   * mappings no longer parse is treated the same way, because the alternative is that a
   * claim we stopped supporting locks every user of that project out.
   */
  async load(tenant: TenantContext): Promise<ClaimTemplate> {
    const row = await this.uow.transaction((tx) => new ClaimTemplateRepository(tx, tenant).find());
    if (row === null) return ClaimTemplate.empty();
    const parsed = claimMappingSchema.array().safeParse(row.claims);
    return parsed.success ? ClaimTemplate.of(parsed.data) : ClaimTemplate.empty();
  }

  async read(tenant: TenantContext): Promise<SavedClaimTemplate> {
    const row = await this.uow.transaction((tx) => new ClaimTemplateRepository(tx, tenant).find());
    if (row === null) {
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

  async save(tenant: TenantContext, input: ClaimTemplateInput): Promise<SavedClaimTemplate> {
    // parseOrThrow and not schema.parse: a raw ZodError escaping a service reaches the
    // exception filter as a 500, and a customer saving a bad template deserves the field
    // list that says which claim it was.
    const template = parseOrThrow(claimTemplateSchema, input);
    assertNamesAreDistinct(template.claims);
    assertPrivateMetadataAcknowledged(template.claims, template.acknowledgePrivateMetadata);
    assertNamesFitTheBudget(template.claims);

    const acknowledgedAt = readsPrivateMetadata(template.claims) ? this.clock.now() : null;
    const updatedAt = await this.uow.transaction((tx) =>
      new ClaimTemplateRepository(tx, tenant).save(template.claims, acknowledgedAt),
    );
    return {
      claims: template.claims,
      acknowledgePrivateMetadata: acknowledgedAt !== null,
      updatedAt: updatedAt.toISOString(),
    };
  }
}

function readsPrivateMetadata(claims: readonly ClaimMapping[]): boolean {
  return claims.some((claim) => claim.source === ClaimSource.MetadataPrivate);
}

/**
 * Two mappings onto one claim name would leave one of them silently doing nothing, and
 * which one depends on the order they happen to be stored in.
 */
function assertNamesAreDistinct(claims: readonly ClaimMapping[]): void {
  const seen = new Set<string>();
  for (const claim of claims) {
    if (seen.has(claim.name)) {
      throw new ValidationFailedError({
        message: "Each claim can be mapped only once.",
        fields: [{ path: `claims.${claim.name}`, code: "duplicate" }],
      });
    }
    seen.add(claim.name);
  }
}

/**
 * Publishing `metadata_private` is a decision, so it is made explicitly.
 *
 * That column is the one place a customer keeps what they did not want a browser to see,
 * and an access token is read by everything the user's device sends it to. This is the
 * last point at which anybody is looking at the question.
 */
function assertPrivateMetadataAcknowledged(
  claims: readonly ClaimMapping[],
  acknowledged: boolean,
): void {
  if (readsPrivateMetadata(claims) && !acknowledged) {
    throw new ValidationFailedError({
      message: "Mapping private metadata into a token publishes it. Acknowledge it to save.",
      fields: [{ path: "acknowledgePrivateMetadata", code: "required" }],
    });
  }
}

/**
 * The names alone must fit, before any value is considered.
 *
 * Measured against the skeleton the claims would render into with empty values, which is
 * the only part of the size a save can know. The rest is checked when the template is
 * applied, because that is the first moment anything knows how big a profile field is.
 */
function assertNamesFitTheBudget(claims: readonly ClaimMapping[]): void {
  const skeleton = Object.fromEntries(claims.map((claim) => [claim.name, ""]));
  const bytes = Buffer.byteLength(JSON.stringify(skeleton), "utf8");
  if (bytes > MAX_CLAIM_BYTES) {
    throw new ValidationFailedError({
      message: "These claim names do not fit inside a token.",
      fields: [{ path: "claims", code: "too_large" }],
    });
  }
}
