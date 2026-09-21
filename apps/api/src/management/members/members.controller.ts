import { MemberRole } from "@idenzy/protocol/enums/tenancy";
import {
  type InviteMember,
  inviteMemberSchema,
  type OrgInvitation,
  type OrgInvitationList,
  type OrgMember,
  type OrgMemberList,
  type OrgSecurity,
  orgSecuritySchema,
  type SetMemberRole,
  setMemberRoleSchema,
  type TransferOwnership,
  transferOwnershipSchema,
} from "@idenzy/protocol/schemas/management";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { actorMemberId, orgContextFrom } from "../tenancy/dashboard-principal.js";
import { RequireRole } from "../tenancy/membership.guard.js";
import { MembersService } from "./members-service.js";

/**
 * The organisation's team.
 *
 * Reading is a viewer's: knowing who else has access is part of knowing what your own
 * access means. Changing it is an admin's, and transferring ownership is the owner's alone —
 * it is the one action that takes something away from the person performing it, and an
 * admin who could do it could hand the organisation to themselves.
 *
 * `members.ts` in the panel puts "the team and their roles" at owner and admin, which is
 * what these decorators say rather than a judgement made here.
 */
@Controller("v1/orgs/:orgId/members")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequireRole(MemberRole.Viewer)
  async list(@Req() request: FastifyRequest): Promise<OrgMemberList> {
    return { members: [...(await this.members.list(orgContextFrom(request)))] };
  }

  @Get("invitations")
  @RequireRole(MemberRole.Admin)
  async invitations(@Req() request: FastifyRequest): Promise<OrgInvitationList> {
    return { invitations: [...(await this.members.invitations(orgContextFrom(request)))] };
  }

  /**
   * Creates an invitation. **Nothing sends it yet.**
   *
   * The row and its hashed token are real; there is no email transport wired to this path,
   * so the screen has to say so. An invitation nobody receives looks exactly like one that
   * was sent and ignored, which is the difference worth stating.
   */
  @Post("invitations")
  @HttpCode(201)
  @RequireRole(MemberRole.Admin)
  async invite(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: InviteMember,
  ): Promise<OrgInvitation> {
    const context = orgContextFrom(request);
    return await this.members.invite(context, body.email, body.role, actorMemberId(request));
  }

  @Post("invitations/:invitationId/resend")
  @HttpCode(204)
  @RequireRole(MemberRole.Admin)
  async resend(
    @Req() request: FastifyRequest,
    @Param("invitationId") invitationId: string,
  ): Promise<void> {
    await this.members.resend(orgContextFrom(request), invitationId);
  }

  @Delete("invitations/:invitationId")
  @HttpCode(204)
  @RequireRole(MemberRole.Admin)
  async revoke(
    @Req() request: FastifyRequest,
    @Param("invitationId") invitationId: string,
  ): Promise<void> {
    await this.members.revoke(orgContextFrom(request), invitationId);
  }

  @Get("security")
  @RequireRole(MemberRole.Viewer)
  async security(@Req() request: FastifyRequest): Promise<OrgSecurity> {
    return { requireMfa: await this.members.requireMfa(orgContextFrom(request)) };
  }

  @Patch("security")
  @HttpCode(200)
  @RequireRole(MemberRole.Admin)
  async setSecurity(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(orgSecuritySchema)) body: OrgSecurity,
  ): Promise<OrgSecurity> {
    const requireMfa = await this.members.setRequireMfa(
      orgContextFrom(request),
      body.requireMfa,
      actorMemberId(request),
    );
    return { requireMfa };
  }

  /** Owner only: it is the one action that takes something away from whoever performs it. */
  @Post("transfer")
  @HttpCode(200)
  @RequireRole(MemberRole.Owner)
  async transfer(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(transferOwnershipSchema)) body: TransferOwnership,
  ): Promise<OrgMemberList> {
    return { members: [...(await this.members.transfer(orgContextFrom(request), body.memberId))] };
  }

  @Patch(":memberId")
  @HttpCode(200)
  @RequireRole(MemberRole.Admin)
  async setRole(
    @Req() request: FastifyRequest,
    @Param("memberId") memberId: string,
    @Body(new ZodValidationPipe(setMemberRoleSchema)) body: SetMemberRole,
  ): Promise<OrgMember> {
    return await this.members.setRole(orgContextFrom(request), memberId, body.role);
  }

  @Delete(":memberId")
  @HttpCode(204)
  @RequireRole(MemberRole.Admin)
  async remove(@Req() request: FastifyRequest, @Param("memberId") memberId: string): Promise<void> {
    await this.members.remove(orgContextFrom(request), memberId);
  }
}
