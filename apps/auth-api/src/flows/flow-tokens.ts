/**
 * Injection tokens for the two structural ports of `AuthFlow`.
 *
 * `FlowHooks` and `FlowAudit` are interfaces in @idenzy/domain, correctly: neither has
 * shared logic that would justify an abstract class (PROJECT.md 7.2.6). An interface
 * erases at runtime and cannot be a Nest token, so these symbols stand in for them and
 * every flow takes them with @Inject.
 */
export const FLOW_HOOKS = Symbol.for("idenzy:flow-hooks");
export const FLOW_AUDIT = Symbol.for("idenzy:flow-audit");
