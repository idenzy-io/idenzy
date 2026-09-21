import { Global, Module } from "@nestjs/common";
import { ClaimTemplateController } from "./claim-template.controller.js";
import { ClaimTemplateService } from "./claim-template-service.js";

/**
 * Customer-defined access-token claims (PROJECT.md 4.2, 9.2).
 *
 * Global, because the thing that reads a template is `SessionService`, and every flow in
 * the system ends there. A module that had to be imported to make tokens carry their
 * claims would be one somebody could leave out of a new app and never notice, since the
 * symptom is a token that is merely smaller than it should be.
 */
@Global()
@Module({
  controllers: [ClaimTemplateController],
  providers: [ClaimTemplateService],
  exports: [ClaimTemplateService],
})
export class ClaimsModule {}
