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

  it("ignores what the client says until the restore it was seeded ahead of settles", () => {
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000001");
    const client = build(new FakeTransport(refused));
    const store = new SessionStore(client, { initial: seed });
    store.subscribe(() => undefined);

    client.signOut().catch(() => undefined);

    expect(store.snapshot().status).toBe("signed-in");
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
  it("let go of the client when the last one unsubscribes", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? json(200, sessionCreated()) : refused(),
    );
    const client = build(transport);
    const store = new SessionStore(client, { restore: false });
    const unsubscribe = store.subscribe(() => undefined);

    unsubscribe();
    await client.signIn.anonymously();

    expect(store.snapshot().status).toBe("signed-out");
  });
});
