import {
  type ColumnClassification,
  DataClass,
  Erasure,
  Purpose,
  Retention,
} from "@idenzy/compliance/classification/vocabulary";

/**
 * Common classification shapes, so a reviewer compares a column against a named preset
 * rather than re-reading five fields. Spread and override where a column differs.
 */

/** Not personal data. Configuration, counters, flags. */
export const config: ColumnClassification = {
  class: DataClass.Operational,
  purpose: Purpose.ServiceConfiguration,
  retention: Retention.ProjectLifetime,
  erasure: Erasure.NotApplicable,
};

/** Operational data tied to an account's lifetime. */
export const accountOperational: ColumnClassification = {
  class: DataClass.Operational,
  purpose: Purpose.AccountManagement,
  retention: Retention.UntilAccountDeletion,
  erasure: Erasure.NotApplicable,
};

/** Directly identifies the end user. Exported on request, tombstoned on erasure. */
export const identifyingPii: ColumnClassification = {
  class: DataClass.Pii,
  purpose: Purpose.Authentication,
  retention: Retention.UntilAccountDeletion,
  subjectField: true,
  erasure: Erasure.Tombstone,
};

/** Credential material. Never exported, never logged, nulled on erasure. */
export const credential: ColumnClassification = {
  class: DataClass.Secret,
  purpose: Purpose.Authentication,
  retention: Retention.UntilAccountDeletion,
  erasure: Erasure.NullOut,
};

/** Security telemetry: IP, user agent, device. Legitimate interest, not contract. */
export const securitySignal: ColumnClassification = {
  class: DataClass.Pii,
  purpose: Purpose.SecurityAndAbusePrevention,
  retention: Retention.Years1,
  subjectField: true,
  erasure: Erasure.Tombstone,
};

/** Short-lived challenge state. Deleted wholesale by the retention worker. */
export const ephemeralChallenge: ColumnClassification = {
  class: DataClass.Pseudonymous,
  purpose: Purpose.Authentication,
  retention: Retention.Days30,
  erasure: Erasure.RowDeleted,
};

/** Audit data. Retained past account deletion by design, kept pseudonymous. */
export const auditRecord: ColumnClassification = {
  class: DataClass.Pseudonymous,
  purpose: Purpose.AuditAndCompliance,
  retention: Retention.Years1,
  erasure: Erasure.RetainPseudonymous,
};
