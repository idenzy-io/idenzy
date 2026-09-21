/** A bundle assembled for one data subject, on its way to somewhere they can fetch it. */
export interface SubjectExportBundle {
  readonly projectId: string;
  readonly requestId: string;
  /** The bytes. JSON today; the port does not care, which is why it takes a buffer and a type. */
  readonly body: Uint8Array;
  readonly contentType: string;
}

/** Where a bundle landed, and the short-lived link that reaches it. */
export interface StoredSubjectExport {
  /** What goes in `data_subject_requests.artifact_uri`. Opaque to everything but the store. */
  readonly uri: string;
  /** A link the requester may follow until it expires. */
  readonly url: string;
  readonly expiresAt: Date;
}

/**
 * Where a data-subject access or portability bundle is put (PROJECT.md 4.13.6).
 *
 * An access request has to end with handing somebody a file, and until this existed there was
 * nowhere for one to land: `data_subject_requests.artifact_uri` had nothing it could point at, so
 * the handlers could not have been written whatever else was in place. That was the real blocker
 * behind "no DSR pipeline", and it was a missing port rather than missing code.
 *
 * **The base owns what must never be skipped**, as `EmailProvider`'s does. A subclass supplies
 * transport; it does not get to decide how long a link lives, because the thing being linked is
 * the most concentrated personal data the system ever assembles — every field about one person, in
 * one object, behind one URL. A provider that quietly handed out a permanent link would turn a
 * compliance obligation into a leak, and the leak would look like success.
 *
 * Declared in the domain and implemented outside it, the inversion that keeps the package graph
 * acyclic (PROJECT.md 8.3).
 */
export abstract class SubjectExportStore {
  /**
   * How long a link to a bundle stays valid.
   *
   * An hour: long enough for somebody to click a link in an email they were expecting, short
   * enough that a forwarded message stops working. The bucket deletes the object entirely on its
   * own schedule (thirty days, matching `artifact_uri`'s classification), so this bounds *reach*
   * rather than retention — two different clocks with two different jobs.
   */
  static readonly LINK_TTL_MS = 60 * 60 * 1000;

  /**
   * Stores a bundle and answers where it went.
   *
   * Template Method: the key is derived here so no implementation invents its own layout, and the
   * TTL is applied here so none can widen it.
   */
  async store(bundle: SubjectExportBundle): Promise<StoredSubjectExport> {
    const key = this.keyFor(bundle);
    const uri = await this.put(key, bundle.body, bundle.contentType);
    const expiresAt = new Date(Date.now() + SubjectExportStore.LINK_TTL_MS);
    return { uri, url: await this.link(key, expiresAt), expiresAt };
  }

  /**
   * Where a bundle lives, derived and never chosen.
   *
   * Project first so a cell's objects group by tenant, then the request id — which is already
   * unique and already the thing the audit trail names. **No subject identifier anywhere in the
   * path**: an object key is not a secret, it appears in logs and in bucket listings, and a layout
   * of `.../alice@example.com.json` would publish the membership of every request to anybody who
   * could list the bucket.
   */
  protected keyFor(bundle: SubjectExportBundle): string {
    return `${bundle.projectId}/${bundle.requestId}.json`;
  }

  /** Puts the bytes. Answers the stored uri. */
  protected abstract put(key: string, body: Uint8Array, contentType: string): Promise<string>;

  /** A link to `key` that stops working at `expiresAt`. */
  protected abstract link(key: string, expiresAt: Date): Promise<string>;
}
