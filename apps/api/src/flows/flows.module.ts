import { Global, Module } from "@nestjs/common";
import { FLOW_AUDIT, FLOW_HOOKS } from "./flow-tokens.js";
import { NullFlowHooks } from "./null-flow-hooks.js";
import { OutboxFlowAudit } from "./outbox-flow-audit.js";

/**
 * The two collaborators every `AuthFlow` inherits (PROJECT.md 9.2, HooksModule and
 * EventsModule).
 *
 * Global, because a flow that could be constructed without them would be a flow that
 * could sign a user in without an audit trail.
 */
@Global()
@Module({
  providers: [
    { provide: FLOW_HOOKS, useClass: NullFlowHooks },
    { provide: FLOW_AUDIT, useClass: OutboxFlowAudit },
  ],
  exports: [FLOW_HOOKS, FLOW_AUDIT],
})
export class FlowsModule {}
