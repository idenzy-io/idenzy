import { ResourceNotFoundError } from "@idenzy/core/errors";
import type { DsrDeadlineRule, DsrKind } from "@idenzy/protocol/enums/compliance";
import { DsrStatus } from "@idenzy/protocol/enums/compliance";
import { dataSubjectRequests } from "../schema/compliance.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface CompletedRequest {
  readonly subjectUserId: string;
  readonly kind: DsrKind;
  readonly deadlineRule: DsrDeadlineRule;
  readonly at: Date;
  readonly dueAt: Date;
  /** Who asked, as the record should name them: a key, a team member, the person themselves. */
  readonly requestedBy: string;
}

/**
 * Data-subject requests (PROJECT.md 4.13.6).
 *
 * Only the completed shape exists so far, written in the same transaction as the work it
 * records. A request answered on the spot still gets its row: received, due and done in one
 * instant is the record an auditor reads to see it was answered, and the subject id it keeps is
 * what proves the erasure happened after everything else about the person is gone.
 */
export class DataSubjectRequestRepository extends BaseRepository<typeof dataSubjectRequests> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, dataSubjectRequests);
  }

  async recordCompleted(request: CompletedRequest): Promise<string> {
    const rows = await this.tx
      .insert(dataSubjectRequests)
      .values({
        projectId: this.context.projectId,
        subjectUserId: request.subjectUserId,
        kind: request.kind,
        status: DsrStatus.Completed,
        requestedAt: request.at,
        deadlineRule: request.deadlineRule,
        dueAt: request.dueAt,
        completedAt: request.at,
        requestedBy: request.requestedBy,
      })
      .returning({ id: dataSubjectRequests.id });
    const row = rows[0];
    if (row === undefined) {
      throw new ResourceNotFoundError({ detail: { entity: "data_subject_requests" } });
    }
    return row.id;
  }
}
