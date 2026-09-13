// Aggregate entry point for the compliance generators, which need one module that reaches every
// analytics table. Application code imports the specific schema module it needs; this file exists
// so `tools/compliance-cli` can populate the classification registry, which is why the
// barrel-file rule is waived here exactly as it is for the Drizzle schema.

export * from "./auth-events.js";
