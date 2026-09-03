import { IdenzyConfigurationError } from "@idenzy/js/errors";
import { seededSession } from "@idenzy/js/session/session-store";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdenzyProvider, useIdenzy, useSession, useUser } from "../src/idenzy-react.js";
import {
  client,
  FakeTransport,
  json,
  refused,
  sessionCreated,
  sessionRefreshed,
  wrapperFor,
} from "./fixtures.js";

afterEach(cleanup);

describe("useSession", () => {
  /**
   * The state this package exists to add. Without it every application renders its
   * signed-out tree for a frame on every load, which is a sign-in form flashed at somebody
   * who is already signed in.
   */
  it("says loading until the first rotation has come back", () => {
    const transport = new FakeTransport(() => json(200, sessionRefreshed()));
    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor(client(transport)) });

    expect(result.current.status).toBe("loading");
  });

  it("comes back signed in from a session the last page load left behind", async () => {
    const transport = new FakeTransport(() => json(200, sessionRefreshed()));
    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor(client(transport)) });

    await waitFor(() => expect(result.current.status).toBe("signed-in"));
    expect(result.current.user?.email).toBe("ada@example.test");
    expect(result.current.sessionId).toBe("ses_00000000000000000001");
  });

  it("comes back signed out when the credential is refused", async () => {
    const transport = new FakeTransport(() => refused());
    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor(client(transport)) });

    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    expect(result.current.user).toBeNull();
  });

  it("never says loading when the provider was told not to restore", () => {
    const transport = new FakeTransport(() => json(200, sessionRefreshed()));
    const { result } = renderHook(() => useSession(), {
      wrapper: wrapperFor(client(transport), false),
    });

    expect(result.current.status).toBe("signed-out");
    expect(transport.requests).toHaveLength(0);
  });

  it("follows a sign-in made through the client", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/anonymous") ? json(200, sessionCreated()) : refused(),
    );
    const instance = client(transport);
    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor(instance) });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));

    await instance.signIn.anonymously();

    await waitFor(() => expect(result.current.status).toBe("signed-in"));
  });
});

describe("a session the server already worked out", () => {
  /**
   * Both sides start from the same snapshot, which is the point: hydration that swapped a
   * signed-out tree for a signed-in one would do it in front of the user.
   */
  it("renders signed in on the first paint, before any request has been made", () => {
    const transport = new FakeTransport(() => json(200, sessionRefreshed()));
    const seed = seededSession("usr_00000000000000000001", "ses_00000000000000000009");
    const { result } = renderHook(() => useSession(), {
      wrapper: ({ children }) => (
        <IdenzyProvider client={client(transport)} initialSession={seed}>
          {children}
        </IdenzyProvider>
      ),
    });

    expect(result.current.status).toBe("signed-in");
    expect(result.current.sessionId).toBe("ses_00000000000000000009");
    // The token names the user and does not carry the profile, so this is null until the
    // rotation that follows brings one back.
    expect(result.current.user).toBeNull();
  });

  /**
   * What `idenzy.session()` answers for a visitor the server could not place, handed over as
   * it arrives. It is a server saying it looked and could not tell, so it renders `loading`
   * and never signed out, and taking null here is what saves a customer from coercing it.
   */
  it("renders loading for the null a server could not place a visitor with", () => {
    const transport = new FakeTransport(() => json(200, sessionRefreshed()));
    const { result } = renderHook(() => useSession(), {
      wrapper: ({ children }) => (
        <IdenzyProvider client={client(transport)} initialSession={null}>
          {children}
        </IdenzyProvider>
      ),
    });

    expect(result.current.status).toBe("loading");
  });
});

describe("useUser", () => {
  it("is null while the answer is still unknown, which is why status exists", () => {
    const transport = new FakeTransport(() => json(200, sessionRefreshed()));
    const { result } = renderHook(() => useUser(), { wrapper: wrapperFor(client(transport)) });

    expect(result.current).toBeNull();
  });
});

/**
 * `useSyncExternalStore` calls `getSnapshot` on every render, so a snapshot rebuilt per call
 * is an infinite loop rather than a slow component. This is the test that would catch it.
 */
describe("re-rendering", () => {
  it("renders once more per real change and not once per notification", async () => {
    const transport = new FakeTransport(() => json(200, sessionRefreshed()));
    const instance = client(transport);
    const renders: number[] = [];

    function Counter(): string {
      const count = useRef(0);
      count.current += 1;
      renders.push(count.current);
      return useSession().status;
    }

    render(
      <IdenzyProvider client={instance}>
        <Counter />
      </IdenzyProvider>,
    );
    await waitFor(() => expect(screen.getByText("signed-in")).toBeDefined());

    // The client re-emits the same state on every subscribe, and nothing above it should see
    // that as a change: one render for loading, one for the session that arrived.
    expect(renders.at(-1)).toBe(2);
  });
});

describe("using a hook outside the provider", () => {
  it("says so where it happened, rather than failing later in an await", () => {
    const noise = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useIdenzy())).toThrow(IdenzyConfigurationError);

    noise.mockRestore();
  });
});

describe("swapping the client", () => {
  /**
   * Keeping the first would leave every hook reporting a session from a client nobody calls
   * any more, which looks exactly like a signed-in user whose every request fails.
   */
  it("refuses a client changed underneath the tree", () => {
    const noise = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = client(new FakeTransport(() => refused()));
    const second = client(new FakeTransport(() => refused()));
    const { rerender } = render(
      <IdenzyProvider client={first} restore={false}>
        <span>ok</span>
      </IdenzyProvider>,
    );

    expect(() =>
      rerender(
        <IdenzyProvider client={second} restore={false}>
          <span>ok</span>
        </IdenzyProvider>,
      ),
    ).toThrow(IdenzyConfigurationError);

    noise.mockRestore();
  });
});

describe("restoring under StrictMode", () => {
  /**
   * React mounts, cleans up and mounts again in development. Two rotations of one refresh
   * token revoke the family, so the second mount must not send a second one (ADR-0007).
   */
  it("rotates once, however many times the effect runs", async () => {
    const transport = new FakeTransport(() => json(200, sessionRefreshed()));
    const instance = client(transport);

    render(
      <StrictMode>
        <IdenzyProvider client={instance}>
          <Status />
        </IdenzyProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText("signed-in")).toBeDefined());

    expect(transport.to("v1/auth/refresh")).toHaveLength(1);
  });
});

function Status(): string {
  return useSession().status;
}
