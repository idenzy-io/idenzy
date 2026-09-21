import { strict as assert } from "node:assert";
import type {
  StoredSubjectExport,
  SubjectExportStore,
} from "@idenzy/domain/ports/subject-export-store";
import { ConformanceSuite } from "./conformance-suite.js";

const PROJECT = "3f2b9c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";
const SUBJECT_EMAIL = "alice@example.test";

/**
 * The suite every export store must pass before it can hold somebody's data (PROJECT.md 7.4).
 *
 * The object under test is the most concentrated personal data this system ever produces: every
 * field about one person, in one place, behind one URL. So the cases here are not about storage
 * working — they are about the ways a working store still leaks.
 *
 * The one that has bitten real systems repeatedly is the key layout. An object key is not a secret:
 * it is in logs, in bucket listings, in error messages. A store that named objects after the
 * subject would publish the membership of every request to anybody who could list the bucket, and
 * every single upload would succeed while it did so.
 */
export class SubjectExportStoreConformanceSuite extends ConformanceSuite<SubjectExportStore> {
  override readonly familyName = "SubjectExportStore";

  private store(subject: SubjectExportStore, requestId: string): Promise<StoredSubjectExport> {
    return subject.store({
      projectId: PROJECT,
      requestId,
      body: new TextEncoder().encode(JSON.stringify({ email: SUBJECT_EMAIL })),
      contentType: "application/json",
    });
  }

  protected override defineCases() {
    return [
      {
        name: "answers with a uri and a link, because a request ends by handing somebody a file",
        run: async ({ subject }: { subject: SubjectExportStore }) => {
          const stored = await this.store(subject, "dsr_conformance_1");
          assert.ok(stored.uri.length > 0, "artifact_uri has nothing to point at");
          assert.ok(stored.url.length > 0, "a bundle nobody can fetch is not an export");
        },
      },
      {
        name: "puts no subject identifier in the uri, because a key is not a secret",
        run: async ({ subject }: { subject: SubjectExportStore }) => {
          const stored = await this.store(subject, "dsr_conformance_2");
          // Keys reach logs and bucket listings. A layout naming the subject would disclose who
          // has asked for their data to anybody who could read either.
          assert.ok(
            !stored.uri.includes(SUBJECT_EMAIL),
            `uri leaks the subject's identifier: ${stored.uri}`,
          );
          assert.ok(
            !stored.uri.includes("alice"),
            `uri leaks part of the identifier: ${stored.uri}`,
          );
        },
      },
      {
        name: "keeps one request's bundle at a different key from another's",
        run: async ({ subject }: { subject: SubjectExportStore }) => {
          const first = await this.store(subject, "dsr_conformance_3");
          const second = await this.store(subject, "dsr_conformance_4");
          // Two requests colliding on one key means one person is handed another's export.
          assert.notEqual(first.uri, second.uri, "two requests shared a uri");
        },
      },
      {
        name: "hands out a link that expires, and within the hour the base allows",
        run: async ({ subject }: { subject: SubjectExportStore }) => {
          const before = Date.now();
          const stored = await this.store(subject, "dsr_conformance_5");
          const ttl = stored.expiresAt.getTime() - before;
          assert.ok(ttl > 0, "a link that has already expired is not a link");
          // The base sets the TTL so an implementation cannot widen it. A permanent link to an
          // export is a leak that looks exactly like a successful export.
          assert.ok(
            ttl <= 60 * 60 * 1000 + 5_000,
            `link lives ${ttl}ms, beyond the hour the base allows`,
          );
        },
      },
    ];
  }
}
