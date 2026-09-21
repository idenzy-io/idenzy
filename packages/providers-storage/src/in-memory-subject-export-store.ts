import { InternalError } from "@idenzy/core/errors";
import { SubjectExportStore } from "@idenzy/domain/ports/subject-export-store";

/**
 * An export store that keeps bundles in the process, for local development and tests.
 *
 * The same shape and the same refusal as `LoggingEmailProvider`: a developer building the
 * data-subject pipeline needs somewhere for a bundle to land before a bucket exists, and the
 * alternative is a stub that eventually ships.
 *
 * **It refuses to construct outside development**, and the reason is sharper here than for a mail
 * transport. What this holds is every field about one person. A process-local map is the right
 * answer on a laptop and a silent, unencrypted, unretained, unauditable copy of a data subject's
 * entire record anywhere else — and it would work perfectly while being that.
 */
export class InMemorySubjectExportStore extends SubjectExportStore {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  constructor(environment: string) {
    super();
    if (environment !== "development") {
      throw new InternalError({
        detail: {
          environment,
          reason: "InMemorySubjectExportStore is development only",
          rule: "a data-subject export must land somewhere durable, retained and audited (4.13.6)",
        },
      });
    }
  }

  protected override put(key: string, body: Uint8Array, contentType: string): Promise<string> {
    this.objects.set(key, { body, contentType });
    // A scheme rather than a bare key, so `artifact_uri` says which store wrote it and a row from
    // a laptop is never mistaken for one from a bucket.
    return Promise.resolve(`memory://${key}`);
  }

  protected override link(key: string, expiresAt: Date): Promise<string> {
    // Not fetchable by anything; the expiry is carried so the shape matches a real store and the
    // conformance suite exercises the same path.
    return Promise.resolve(`memory://${key}?expires=${expiresAt.toISOString()}`);
  }

  /** What was stored, for a test to assert on. Never part of the port. */
  read(key: string): Uint8Array | null {
    return this.objects.get(key)?.body ?? null;
  }

  get size(): number {
    return this.objects.size;
  }
}
