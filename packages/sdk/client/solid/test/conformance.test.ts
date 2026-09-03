import type { Idenzy } from "@idenzy/js";
import { LOADING_SESSION, type SessionSnapshot } from "@idenzy/js/session/session-store";
import {
  BindingConformanceSuite,
  type MountedBinding,
  type MountOptions,
} from "@idenzy/sdk-conformance/binding-conformance";
import { type Accessor, createComponent, createRoot, type JSX } from "solid-js";
import { describe, expect, it } from "vitest";
import { IdenzyProvider, useSession } from "../src/idenzy-solid.js";

/** Long enough for the transport, the parse and the publish behind a restore. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * The adapter: the real provider around one consumer, disposed through its own root.
 *
 * The children are behind a getter because Solid's `Provider` resolves them inside its own
 * owner, and that owner is what carries the context. Evaluating them at the call site would
 * run the primitive outside the provider and test nothing a customer does.
 */
function mount(client: Idenzy, options: MountOptions): MountedBinding {
  let seen: Accessor<SessionSnapshot> = () => LOADING_SESSION;
  const consumer = (): JSX.Element => {
    seen = useSession();
    return null;
  };

  const dispose = createRoot((disposeRoot) => {
    createComponent(IdenzyProvider, {
      client,
      ...(options.restore === undefined ? {} : { restore: options.restore }),
      ...(options.initial === undefined ? {} : { initial: options.initial }),
      get children(): JSX.Element {
        return createComponent(consumer, {});
      },
    });
    return disposeRoot;
  });

  return {
    session: () => seen(),
    settle: flush,
    unmount: dispose,
  };
}

/**
 * PROJECT.md 3.3 and 7.4. Seven bindings wrap one `SessionStore`, and what a customer sees
 * must not depend on which of them they picked.
 */
describe("@idenzy/solid", () => {
  it("satisfies the binding contract", async () => {
    const failures = await new BindingConformanceSuite().run({ name: "solid", subject: mount });

    expect(failures).toEqual([]);
  });
});
