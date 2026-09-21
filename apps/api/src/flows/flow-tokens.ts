/**
 * Injection tokens for the three structural ports of `AuthFlow`.
 *
 * `FlowHooks`, `FlowAudit` and `MfaGate` are interfaces in @idenzy/domain, correctly:
 * none has shared logic that would justify an abstract class (PROJECT.md 7.2.6). An
 * interface erases at runtime and cannot be a Nest token, so these symbols stand in for
 * them and every flow takes them with @Inject.
 *
 * `MFA_GATE` is bound in `MfaModule` rather than beside the other two, because the only
 * implementation needs the factor registry. The token lives here because the thing that
 * cannot be built without it is a flow.
 */
export const FLOW_HOOKS = Symbol.for("idenzy:flow-hooks");
export const FLOW_AUDIT = Symbol.for("idenzy:flow-audit");
export const MFA_GATE = Symbol.for("idenzy:mfa-gate");
