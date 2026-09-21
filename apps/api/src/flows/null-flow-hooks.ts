import type { FlowContext, FlowHooks } from "@idenzy/domain/ports/auth-flow";
import { Injectable } from "@nestjs/common";

/**
 * No customer hooks yet (PROJECT.md 3.2, phase 3).
 *
 * It exists rather than the call site being optional, so the invocation point stays in
 * `AuthFlow` and adding real hooks is a change to this class alone. When they arrive
 * they are fail-closed with a hard deadline, which is much easier to get right if
 * nothing has to move to accommodate them.
 */
@Injectable()
export class NullFlowHooks implements FlowHooks {
  beforeSignIn(_context: FlowContext, _userId: string): Promise<void> {
    return Promise.resolve();
  }
}
