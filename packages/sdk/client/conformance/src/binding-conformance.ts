/**
 * The suite every client binding must pass (PROJECT.md 3.3, 7.4).
 *
 * React, Vue, Svelte, Angular and Solid each wrap the same `SessionStore` in whatever their
 * framework calls external state, so what a customer sees should not depend on which one they
 * picked. Every case here is a rule the store owns and the binding inherits, and every one of
 * them has been got wrong at least once in a binding that otherwise worked: a null seed
 * dropped on the way through, the client's opening position published over a server's answer,
 * a subscription left on a client that outlived the tree.
 *
 * It deliberately does not extend `ConformanceSuite` from `@idenzy/testing`. That package
 * carries Postgres, Testcontainers and the domain layer behind it, and making a browser
 * binding's test run depend on all of it would put the whole server stack in the build graph
 * of `pnpm test` for `@idenzy/react`. The shared piece would be the loop below.
 */
import { strict as assert } from "node:assert";
import type { Idenzy } from "@idenzy/js";
import { type SessionSnapshot, seededSession } from "@idenzy/js/session/session-store";
import {
  answer,
  countSubscriptions,
  FakeTransport,
  PendingTransport,
  refused,
  sessionCreated,
  sessionRefreshed,
  testClient,
  user,
} from "./fixtures.js";

/**
 * What a binding is asked to do, in the two ways it can be configured wrongly.
 *
 * Both keys are optional and both are load-bearing when absent. `restore` absent is on, and
 * `initial` absent is different from `initial: null`: null is a server saying it looked and
 * could not place the visitor, absent says nobody looked. A binding hands them on exactly as
 * it received them, which under `exactOptionalPropertyTypes` means spreading the key
 * conditionally rather than passing a value that may be undefined.
 */
export interface MountOptions {
  readonly restore?: boolean;
  readonly initial?: SessionSnapshot | null;
}

/** A mounted binding, seen the way a component in it would see one. */
export interface MountedBinding {
  /** What the binding's own session primitive reports right now. */
  session(): SessionSnapshot;
  /** Lets the framework's scheduling and any pending promises run. */
  settle(): Promise<void>;
  /** Takes the tree down, so a case can assert the binding let go of the client. */
  unmount(): void;
}

/**
 * The adapter a binding provides: mount a tree that reads the session, hand back a view of it.
 *
 * A factory rather than an instance, because every case needs a tree of its own.
 */
export type BindingFactory = (
  client: Idenzy,
  options: MountOptions,
) => MountedBinding | Promise<MountedBinding>;

export interface BindingConformanceContext {
  readonly subject: BindingFactory;
  readonly name: string;
}

interface Case {
  readonly name: string;
  readonly run: (mount: BindingFactory) => Promise<void>;
}

const SEED_USER = "usr_00000000000000000001";
const SEED_SESSION = "ses_00000000000000000009";

/** Mounts, runs the case against it and takes the tree down whatever happened. */
async function mounted(
  mount: BindingFactory,
  client: Idenzy,
  options: MountOptions,
  body: (view: MountedBinding) => void | Promise<void>,
): Promise<void> {
  const view = await mount(client, options);
  try {
    await body(view);
  } finally {
    view.unmount();
  }
}

const CASES: readonly Case[] = [
  {
    /**
     * The third status, and the reason there is one. A binding that collapses it into
     * signed-out shows a sign-in screen to somebody who is already signed in, once per load.
     */
    name: "says loading while the first answer is still in flight",
    run: async (mount) => {
      const client = testClient(new PendingTransport());
      await mounted(mount, client, {}, async (view) => {
        await view.settle();
        assert.equal(
          view.session().status,
          "loading",
          "a binding with no answer yet must say loading, not signed out",
        );
        assert.equal(view.session().user, null, "there is no user to report while loading");
      });
    },
  },
  {
    name: "comes back signed in from a session the last page load left behind",
    run: async (mount) => {
      const client = testClient(new FakeTransport(() => answer(200, sessionRefreshed())));
      await mounted(mount, client, {}, async (view) => {
        await view.settle();
        const session = view.session();
        assert.equal(session.status, "signed-in", "a restored session must reach the view");
        assert.equal(session.userId, user().id);
        assert.equal(session.sessionId, "ses_00000000000000000001");
        assert.equal(
          session.user?.email,
          user().email,
          "the profile came back with the rotation and must be published with it",
        );
      });
    },
  },
  {
    name: "comes back signed out when the credential is refused",
    run: async (mount) => {
      const client = testClient(new FakeTransport(refused));
      await mounted(mount, client, {}, async (view) => {
        await view.settle();
        assert.equal(view.session().status, "signed-out");
        assert.equal(view.session().user, null);
      });
    },
  },
  {
    /**
     * `restore: false` with nothing seeded is the one case where the client's own position is
     * the answer: nobody is going to look, so holding `loading` would hold it forever.
     */
    name: "answers signed out at once when it was told not to restore",
    run: async (mount) => {
      const transport = new FakeTransport(() => answer(200, sessionRefreshed()));
      const client = testClient(transport);
      await mounted(mount, client, { restore: false }, async (view) => {
        assert.equal(
          view.session().status,
          "signed-out",
          "nothing is going to answer, so loading here never ends",
        );
        await view.settle();
        assert.equal(transport.requests.length, 0, "restore: false must not reach the network");
      });
    },
  },
  {
    /**
     * The bug this suite exists for. A server that could not place the visitor returns null,
     * and a binding that drops the key on null says nobody looked: with `restore: false` on a
     * server render that puts the signed-out tree in the HTML of every page.
     */
    name: "holds loading through a server render that could not place the visitor",
    run: async (mount) => {
      const transport = new FakeTransport(() => answer(200, sessionRefreshed()));
      const client = testClient(transport);
      await mounted(mount, client, { restore: false, initial: null }, async (view) => {
        assert.equal(
          view.session().status,
          "loading",
          "a null seed is a server reporting that it looked and could not tell, not a signed-out visitor",
        );
        await view.settle();
        assert.equal(view.session().status, "loading");
        assert.equal(transport.requests.length, 0, "restore: false must not reach the network");
      });
    },
  },
  {
    /**
     * Both sides start from the same snapshot, so hydration does not swap the tree. The seed
     * carries no profile, because the access token names the user and does not contain them.
     */
    name: "renders the seed a server worked out, before any request",
    run: async (mount) => {
      const transport = new FakeTransport(refused);
      const client = testClient(transport);
      const seed = seededSession(SEED_USER, SEED_SESSION);
      await mounted(mount, client, { restore: false, initial: seed }, (view) => {
        const session = view.session();
        assert.equal(session.status, "signed-in", "the seed must reach the first paint");
        assert.equal(session.userId, SEED_USER);
        assert.equal(session.sessionId, SEED_SESSION);
        assert.equal(session.user, null, "a seed names the user and carries no profile");
        assert.equal(transport.requests.length, 0);
      });
    },
  },
  {
    /**
     * `Idenzy.subscribe` reports the client's opening position immediately, and a client that
     * has not rotated says signed-out because it holds nothing rather than because nobody is
     * signed in. Published over a server's seed, that turns a signed-in page into a sign-in
     * screen the moment a component subscribes.
     */
    name: "does not publish the client's opening position over the seed",
    run: async (mount) => {
      const client = testClient(new FakeTransport(refused));
      const seed = seededSession(SEED_USER, SEED_SESSION);
      await mounted(mount, client, { restore: false, initial: seed }, async (view) => {
        await view.settle();
        assert.equal(
          view.session().status,
          "signed-in",
          "the client's opening position is not an answer and must not replace the seed",
        );
      });
    },
  },
  {
    name: "follows a sign-in made through the client",
    run: async (mount) => {
      const client = testClient(
        new FakeTransport((request) =>
          request.url.endsWith("v1/auth/anonymous") ? answer(200, sessionCreated()) : refused(),
        ),
      );
      await mounted(mount, client, {}, async (view) => {
        await view.settle();
        assert.equal(view.session().status, "signed-out");

        await client.signIn.anonymously();
        await view.settle();

        assert.equal(view.session().status, "signed-in", "a later change must reach the view");
        assert.equal(view.session().sessionId, "ses_00000000000000000002");
      });
    },
  },
  {
    /**
     * One store per binding, not one per component that asks. React runs an effect, cleans it
     * up and runs it again in development, and the rotation underneath is the operation where
     * spending the same token twice revokes the whole family (ADR-0007).
     */
    name: "restores at most once",
    run: async (mount) => {
      const transport = new FakeTransport(() => answer(200, sessionRefreshed()));
      const client = testClient(transport);
      await mounted(mount, client, {}, async (view) => {
        await view.settle();
        await view.settle();
        assert.equal(
          transport.to("v1/auth/refresh").length,
          1,
          "a binding must restore once however many times its effects run",
        );
      });
    },
  },
  {
    /** The client is built once and outlives every view of it, so nothing may be left on it. */
    name: "lets go of the client when the tree comes down",
    run: async (mount) => {
      const client = testClient(new FakeTransport(refused));
      const subscriptions = countSubscriptions(client);
      const view = await mount(client, {});
      await view.settle();
      assert.ok(
        subscriptions.total > 0,
        "a binding that never subscribed cannot be following the session",
      );

      view.unmount();

      assert.equal(
        subscriptions.active,
        0,
        "a listener left on the client keeps the whole tree alive and reports a session nobody is calling",
      );
    },
  },
];

/**
 * The suite a binding runs with one line, collecting failures rather than stopping at the
 * first so a new binding sees everything it has to fix in one run.
 *
 * Run it against the binding's real provider and its real session primitive. An adapter that
 * reaches into `SessionStore` itself would pass every case here while the thing a customer
 * imports stays broken.
 */
export class BindingConformanceSuite {
  readonly familyName = "SessionBinding";

  async run(context: BindingConformanceContext): Promise<readonly string[]> {
    const failures: string[] = [];
    for (const testCase of CASES) {
      try {
        await testCase.run(context.subject);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${this.familyName}/${context.name}: ${testCase.name}: ${reason}`);
      }
    }
    return failures;
  }
}
