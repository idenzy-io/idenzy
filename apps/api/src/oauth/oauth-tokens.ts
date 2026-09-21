/**
 * The set of identity providers this deployment implements.
 *
 * A `ReadonlyMap` cannot be a Nest token, so this symbol stands in for it, the same way
 * FLOW_HOOKS and FLOW_AUDIT stand in for their interfaces. Binding it in the module
 * rather than constructing it inside the registry is what lets a test swap in a provider
 * that answers without a network.
 */
export const OAUTH_PROVIDERS = Symbol.for("idenzy:oauth-providers");
