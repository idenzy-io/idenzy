import { ResourceConflictError, ValidationFailedError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { OrgMembershipReader } from "@idenzy/persistence/repository/org-membership-reader";
import { ProvisioningRepository } from "@idenzy/persistence/repository/provisioning-repository";
import { RegionCellReader } from "@idenzy/persistence/repository/region-cell-reader";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { ComplianceTier, MemberRole } from "@idenzy/protocol/enums/tenancy";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { OnboardingResult, StartOnboarding } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";

/**
 * Getting started: one organisation, one owner, one project, one transaction.
 *
 * The shape is deliberate. A person who registers directly gets an organisation of their
 * own; a person who accepts an invitation joins somebody else's and never comes through
 * here. Creating all of it at once rather than at registration means somebody who
 * abandons the form leaves no rows behind, and there is never an organisation with no
 * project for the panel to have to render.
 *
 * The region is a real decision and is treated as one. It pins the project to a cell,
 * which is immutable afterwards because moving a project is an audited migration and not
 * a setting (PROJECT.md 4.13.5). It is validated against the cells we actually run rather
 * than against a list in the client, so a code the panel offers by mistake is refused
 * here rather than pinning somebody's data to a stack that does not exist.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly memberships: OrgMembershipReader,
    private readonly regions: RegionCellReader,
  ) {}

  /**
   * Whether this person still has to go through getting started.
   *
   * Membership in any organisation is the whole test. Somebody who was invited into one
   * has a project already and must not be asked to make another.
   */
  async isRequired(userId: string): Promise<boolean> {
    return (await this.memberships.organisations(userId)).length === 0;
  }

  async start(
    userId: string,
    displayName: string | null,
    input: StartOnboarding,
  ): Promise<OnboardingResult> {
    // Refused rather than made idempotent. A second organisation is a real thing somebody
    // may want, but it is not what this endpoint is for, and quietly creating one from a
    // resubmitted form is how a customer ends up with two and no idea which is which.
    if (!(await this.isRequired(userId))) {
      throw new ResourceConflictError({
        message: "This account already belongs to an organisation.",
      });
    }

    const cell = await this.regions.byCode(input.region);
    if (cell === null) {
      throw new ValidationFailedError({
        message: "That is not a region we run.",
        fields: [{ path: "region", code: "unknown_region" }],
      });
    }

    const provisioned = await this.uow.provision(async (tx, orgId) => {
      const repository = new ProvisioningRepository(tx, orgId);
      const created = await repository.create({
        // Their own name where they gave us one, because a personal organisation is a
        // person and "Untitled" would be the first thing they saw on their own dashboard.
        orgName: input.organisationName ?? displayName ?? input.projectName,
        ownerUserId: userId,
        projectName: input.projectName,
        cellId: cell.id,
        complianceTier: ComplianceTier.Standard,
      });
      await repository.recordAnswers(created.memberId, {
        useCase: input.useCase ?? null,
        heardFrom: input.heardFrom ?? null,
      });
      return created;
    });

    const joinedAt = new Date().toISOString();
    return {
      organisation: {
        id: PublicId.encode(IdPrefix.Org, provisioned.orgId).value,
        name: input.organisationName ?? displayName ?? input.projectName,
        memberId: PublicId.encode(IdPrefix.Member, provisioned.memberId).value,
        role: MemberRole.Owner,
        joinedAt,
      },
      project: {
        id: PublicId.encode(IdPrefix.Project, provisioned.projectId).value,
        name: input.projectName,
        region: cell.code,
        plan: "free",
        complianceTier: ComplianceTier.Standard,
        createdAt: joinedAt,
      },
    };
  }
}
