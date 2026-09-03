/**
 * The Angular binding for `@idenzy/js`: one provider, one injectable and two signals.
 *
 * There is no component and no directive in this package, and there will not be. The sign-in
 * page is the most brand-sensitive surface in most products and it belongs to whoever owns the
 * product (ADR-0002).
 *
 * There is no route guard either, and that is the same decision rather than a gap: where an
 * unauthenticated visitor should land is a product choice, and a `CanActivateFn` reading
 * `idenzy.session()` is three lines a customer owns. It also keeps this package's peer
 * dependency to `@angular/core`, so an application without the router can still use it.
 */

import {
  computed,
  DestroyRef,
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
  type Signal,
  signal,
} from "@angular/core";
import type { Idenzy } from "@idenzy/js";
import {
  type SessionSnapshot,
  SessionStore,
  type SessionStoreOptions,
} from "@idenzy/js/session/session-store";
import type { PublicUser } from "@idenzy/protocol/schemas/user";

export type { SessionSnapshot };

export interface IdenzyOptions extends SessionStoreOptions {
  /**
   * The client, built once and outside the injector.
   *
   * An `Idenzy` owns the session, the refresh token and the single-flight promise that keeps
   * one rotation from becoming two. Two clients rotating the same token means the second
   * rotation revokes the whole family (ADR-0007).
   */
  readonly client: Idenzy;
}

/**
 * What a component injects: the client for the calls, and signals for the state.
 *
 * Signals rather than observables. The session is a value that is always there and always has
 * a current answer, which is what a signal is; an observable would need a `BehaviorSubject`
 * and an `async` pipe to say the same thing less directly.
 */
export class IdenzySession {
  /**
   * Read `status` rather than testing `user` for null. The three states are distinct and the
   * middle one matters: `loading` is the answer until the first rotation has come back, and
   * treating it as signed out shows a sign-in screen to someone already signed in.
   */
  readonly session: Signal<SessionSnapshot>;
  /**
   * The signed-in user, or null while nobody is and while the answer is unknown. Also null on
   * a server-rendered first paint of a signed-in user: the token names them and carries no
   * profile.
   */
  readonly user: Signal<PublicUser | null>;

  private readonly store: SessionStore;
  private readonly stop: () => void;

  constructor(
    readonly client: Idenzy,
    options: SessionStoreOptions = {},
  ) {
    this.store = new SessionStore(client, options);
    const current = signal<SessionSnapshot>(this.store.snapshot());
    this.stop = this.store.subscribe(() => {
      current.set(this.store.snapshot());
    });

    this.session = current.asReadonly();
    this.user = computed(() => current().user);
    void this.store.restore();
  }

  /** Lets go of the client. Wired to the injector's lifetime by `provideIdenzy`. */
  destroy(): void {
    this.stop();
  }
}

/**
 * `provideIdenzy({ client })` in `bootstrapApplication`, then `inject(IdenzySession)`.
 *
 * Environment-scoped rather than root-provided, so the client is a value the application
 * hands in rather than one this package goes looking for, and so a server-rendered request
 * gets its own. Nothing here is decorated: an explicit factory needs no `@Injectable`, which
 * keeps this package buildable with plain `tsc` and free of an Angular compiler step.
 */
export function provideIdenzy(options: IdenzyOptions): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: IdenzySession,
      useFactory: (): IdenzySession => {
        const state = new IdenzySession(options.client, options);
        inject(DestroyRef).onDestroy(() => {
          state.destroy();
        });
        return state;
      },
    },
  ]);
}
