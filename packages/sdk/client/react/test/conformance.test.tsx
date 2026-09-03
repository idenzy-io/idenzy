import type { Idenzy } from "@idenzy/js";
import { LOADING_SESSION, type SessionSnapshot } from "@idenzy/js/session/session-store";
import {
  BindingConformanceSuite,
  type MountedBinding,
  type MountOptions,
} from "@idenzy/sdk-conformance/binding-conformance";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { IdenzyProvider, useSession } from "../src/idenzy-react.js";

afterEach(cleanup);

/** Puts what the hook reports where a case can read it, and renders nothing of its own. */
function Probe({ box }: { readonly box: { current: SessionSnapshot } }): ReactNode {
  box.current = useSession();
  return null;
}

/**
 * The adapter: the real provider and the real hook, with a probe where a customer's component
 * would be. Reaching into `SessionStore` here instead would pass every case while the thing a
 * customer imports stayed broken.
 */
function mount(client: Idenzy, options: MountOptions): MountedBinding {
  const box = { current: LOADING_SESSION };
  const view = render(
    <IdenzyProvider
      client={client}
      {...(options.restore === undefined ? {} : { restore: options.restore })}
      {...(options.initial === undefined ? {} : { initialSession: options.initial })}
    >
      <Probe box={box} />
    </IdenzyProvider>,
  );
  return {
    session: () => box.current,
    settle: async () => {
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      });
    },
    unmount: () => {
      view.unmount();
    },
  };
}

/**
 * PROJECT.md 3.3 and 7.4. Seven bindings wrap one `SessionStore`, and what a customer sees
 * must not depend on which of them they picked.
 */
describe("@idenzy/react", () => {
  it("satisfies the binding contract", async () => {
    const failures = await new BindingConformanceSuite().run({ name: "react", subject: mount });

    expect(failures).toEqual([]);
  });
});
