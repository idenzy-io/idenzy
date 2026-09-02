/** Data-subject request kinds, per GDPR Art.15, 16, 17 and 20 (PROJECT.md 4.13.6). */
export const DsrKind = {
  Access: "access",
  Rectification: "rectification",
  Erasure: "erasure",
  Portability: "portability",
} as const;
export type DsrKind = (typeof DsrKind)[keyof typeof DsrKind];

/** Lifecycle of a data-subject request. `due_at` is set at intake and is monitored. */
export const DsrStatus = {
  Received: "received",
  InProgress: "in_progress",
  Completed: "completed",
  Rejected: "rejected",
} as const;
export type DsrStatus = (typeof DsrStatus)[keyof typeof DsrStatus];

/** Who performed an audited action. */
export const ActorType = {
  User: "user",
  CustomerStaff: "customer_staff",
  ApiKey: "api_key",
  IdenzyStaff: "idenzy_staff",
  System: "system",
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];
