/** Serialises a rotation against the other tabs of the same origin (ADR-0007). */
export interface RefreshLock {
  run<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * The Web Locks API, which is what makes three tabs waking together survive strict rotation.
 *
 * The server has no grace window: presenting an already-rotated token revokes the whole family,
 * because "the same client retrying" and "a second holder of the same secret" are the same
 * observation at the server (ADR-0007). Solving that is the client's job, and one promise per
 * tab only covers one tab. In cookie mode every tab shares one refresh cookie, so two tabs
 * rotating at once send the same token twice and sign the user out of every device.
 *
 * The lock is named per project, so two clients for two projects on one page do not queue
 * behind each other.
 *
 * Where the API is absent the work simply runs. That is not a silent downgrade: without
 * `navigator.locks` there is no shared cookie either, because the runtimes that lack it are the
 * ones with a single process and a per-instance token store.
 */
export class WebLocksRefreshLock implements RefreshLock {
  private readonly name: string;

  constructor(scope: string) {
    this.name = `idenzy.refresh.${scope}`;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    const locks = globalThis.navigator?.locks;
    if (locks === undefined) return work();
    return locks.request(this.name, work);
  }
}
