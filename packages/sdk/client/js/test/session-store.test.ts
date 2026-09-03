import { describe, expect, it } from "vitest";
import { Idenzy } from "../src/idenzy.js";
import { SessionStore, seededSession } from "../src/session/session-store.js";
import { errorBody, FakeTransport, FixedClock, json, sessionCreated, user } from "./fixtures.js";

function build(transport: FakeTransport): Idenzy {
  return new Idenzy(
    { publishableKey: "pk_test_abc", apiUrl: "https://auth.acme.test" },
    { transport, clock: new FixedClock() },
  );
}

function refused(): ReturnType<typeof json> {
  return json(401, errorBody("invalid_credentials"));
}

describe("before the first rotation answers", () => {
  it("says loading, which is what keeps a sign-in form off a signed-in user's screen", () => {
    const store = new SessionStore(build(new FakeTransport(refused)));

    expect(store.snapshot().status).toBe("loading");
  });

  it("says signed out when told not to restore, because nothing is going to look", () => {
    const store = new SessionStore(build(new FakeTransport(refused)), { restore: false });

    expect(store.snapshot().status).toBe("signed-out");
  });

  it("keeps a seed from the server, so hydration does not swap the tree", () => {
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000001");
    const store = new SessionStore(build(new FakeTransport(refused)), { initial: seed });

    expect(store.snapshot()).toEqual(seed);
    expect(store.serverSnapshot()).toEqual(seed);
    // The profile is not in the token, so a seeded snapshot names the user and holds no
    // profile. A view that needs one has to be given it.
    expect(store.snapshot().user).toBeNull();
  });

  /**
   * A client that has not rotated reports signed-out because it has nothing, not because
   * nobody is signed in, and `subscribe` reports that opening position immediately. Letting
   * it through would turn a server-rendered signed-in page into a sign-in screen the moment
   * a component subscribed.
   */
  it("keeps the seed when a subscriber arrives before the client has looked", () => {
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000001");
    const store = new SessionStore(build(new FakeTransport(refused)), { initial: seed });

    store.subscribe(() => undefined);

    expect(store.snapshot()).toEqual(seed);
  });

  it("keeps the seed even where nothing is going to restore, which is a server render", () => {
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000001");
    const store = new SessionStore(build(new FakeTransport(refused)), {
      restore: false,
      initial: seed,
    });

    store.subscribe(() => undefined);

    expect(store.snapshot()).toEqual(seed);
  });

  it("follows the client the moment it does have an opinion", async () => {
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000009");
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? json(200, sessionCreated()) : refused(),
    );
    const client = build(transport);
    const store = new SessionStore(client, { restore: false, initial: seed });
    store.subscribe(() => undefined);

    await client.signIn.anonymously();

    // The seed named the user and carried no profile; the real session carries one.
    expect(store.snapshot().sessionId).not.toBe("ses_00000000000000000009");
    expect(store.snapshot().user).toEqual(user());
  });
});

describe("restoring", () => {
  it("ends signed out when the credential is refused", async () => {
    const store = new SessionStore(build(new FakeTransport(refused)));

    await store.restore();

    expect(store.snapshot().status).toBe("signed-out");
  });

  it("rotates once however many times it is called", async () => {
    const transport = new FakeTransport(refused);
    const store = new SessionStore(build(transport));

    await Promise.all([store.restore(), store.restore()]);
    await store.restore();

    expect(transport.to("v1/auth/refresh")).toHaveLength(1);
  });
});

describe("subscribers", () => {
  it("are told once per real change and not once per notification", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? json(200, sessionCreated()) : refused(),
    );
    const client = build(transport);
    const store = new SessionStore(client);
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });

    await store.restore();
    await client.signIn.anonymously();

    // Signed out once the restore failed, signed in once the flow finished. The client emits
    // more often than that; an identical snapshot is not a change.
    expect(told).toBe(2);
  });

  it("hand back the same object while nothing has changed", async () => {
    const store = new SessionStore(build(new FakeTransport(refused)));
    await store.restore();

    expect(store.snapshot()).toBe(store.snapshot());
  });

  it("carry the profile once there is one to carry", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? json(200, sessionCreated()) : refused(),
    );
    const client = build(transport);
    const store = new SessionStore(client, { restore: false });
    store.subscribe(() => undefined);

    await client.signIn.anonymously();

    expect(store.snapshot().user).toEqual(user());
    expect(store.snapshot().userId).toBe(user().id);
  });

  /** Nothing may be left hanging off a client that outlives the view that was watching it. */
  it("are not told anything after the last one unsubscribes", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? json(200, sessionCreated()) : refused(),
    );
    const client = build(transport);
    const store = new SessionStore(client, { restore: false });
    let told = 0;
    const unsubscribe = store.subscribe(() => {
      told += 1;
    });

    unsubscribe();
    await client.signIn.anonymously();

    expect(told).toBe(0);
  });

  /** A view that left and came back must not be shown what was true when it left. */
  it("catch up on what happened while nothing was listening", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? json(200, sessionCreated()) : refused(),
    );
    const client = build(transport);
    const store = new SessionStore(client, { restore: false });
    store.subscribe(() => undefined)();

    await client.signIn.anonymously();
    store.subscribe(() => undefined);

    expect(store.snapshot().status).toBe("signed-in");
  });
});
