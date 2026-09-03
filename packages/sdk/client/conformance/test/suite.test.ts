import type { Idenzy } from "@idenzy/js";
import { type SessionSnapshot, SessionStore, snapshotOf } from "@idenzy/js/session/session-store";
import { describe, expect, it } from "vitest";
import {
  BindingConformanceSuite,
  type BindingFactory,
  type MountedBinding,
  type MountOptions,
} from "../src/binding-conformance.js";

/** Lets the transport's promise and everything chained onto it run. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function storeFor(client: Idenzy, options: MountOptions): SessionStore {
  return new SessionStore(client, {
    ...(options.restore === undefined ? {} : { restore: options.restore }),
    ...(options.initial === undefined ? {} : { initial: options.initial }),
  });
}

/**
 * A binding with no framework in it, which is what every real one is once its own way of
 * holding external state is taken away.
 *
 * It is here so the suite is exercised against something known to be right, and so the four
 * broken ones below have something to be broken relative to.
 */
function reference(client: Idenzy, options: MountOptions): MountedBinding {
  const store = storeFor(client, options);
  let current = store.snapshot();
  const stop = store.subscribe(() => {
    current = store.snapshot();
  });
  void store.restore();
  return {
    session: () => current,
    settle: flush,
    unmount: stop,
  };
}

/** Two statuses instead of three, which is a sign-in screen shown to somebody signed in. */
function collapsesLoading(client: Idenzy, options: MountOptions): MountedBinding {
  const view = reference(client, options);
  return {
    ...view,
    session: (): SessionSnapshot => {
      const session = view.session();
      return session.status === "loading" ? { ...session, status: "signed-out" } : session;
    },
  };
}

/** Passes the seed on only when it is truthy, so a server's null becomes nobody looked. */
function dropsNullSeed(client: Idenzy, options: MountOptions): MountedBinding {
  return reference(client, {
    ...(options.restore === undefined ? {} : { restore: options.restore }),
    ...(options.initial ? { initial: options.initial } : {}),
  });
}

/** Follows the client rather than the store, so its opening position lands on top of the seed. */
function publishesTheEcho(client: Idenzy, options: MountOptions): MountedBinding {
  const store = storeFor(client, options);
  let current = store.snapshot();
  const stop = client.subscribe(() => {
    current = snapshotOf(client);
  });
  void store.restore();
  return {
    session: () => current,
    settle: flush,
    unmount: stop,
  };
}

/** Leaves its listener on a client that outlives the tree. */
function neverReleases(client: Idenzy, options: MountOptions): MountedBinding {
  const view = reference(client, options);
  return { ...view, unmount: () => undefined };
}

describe("the reference binding", () => {
  it("passes every case", async () => {
    const failures = await new BindingConformanceSuite().run({
      name: "reference",
      subject: reference,
    });

    expect(failures).toEqual([]);
  });
});

/**
 * A suite that cannot fail proves nothing, and each of these is a mistake a real binding has
 * made: the third status collapsed, a null seed dropped on the way through, the client's
 * opening position published over a server's answer, a subscription left behind.
 */
describe("a binding that breaks one of the rules the store owns", () => {
  const broken: readonly [string, BindingFactory, string][] = [
    ["collapses loading into signed out", collapsesLoading, "says loading while the first answer"],
    ["drops a null seed", dropsNullSeed, "holds loading through a server render"],
    ["publishes the echo", publishesTheEcho, "does not publish the client's opening position"],
    ["never releases the client", neverReleases, "lets go of the client when the tree comes down"],
  ];

  it.each(broken)("is caught: %s", async (_name, subject, expected) => {
    const failures = await new BindingConformanceSuite().run({ name: "broken", subject });

    expect(failures.some((failure) => failure.includes(expected))).toBe(true);
  });
});
