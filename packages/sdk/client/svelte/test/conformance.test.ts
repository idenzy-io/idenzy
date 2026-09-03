import type { Idenzy } from "@idenzy/js";
import { LOADING_SESSION } from "@idenzy/js/session/session-store";
import {
  BindingConformanceSuite,
  type MountedBinding,
  type MountOptions,
} from "@idenzy/sdk-conformance/binding-conformance";
import { describe, expect, it } from "vitest";
import { createIdenzy } from "../src/idenzy-svelte.js";

/** Long enough for the transport, the parse and the publish behind a restore. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * The adapter: the real stores, subscribed to the way `$session` subscribes to them.
 *
 * `createIdenzy` rather than `setIdenzy`, because Svelte's context needs a component
 * initialising and the store is the half every case here is about.
 */
function mount(client: Idenzy, options: MountOptions): MountedBinding {
  const context = createIdenzy({
    client,
    ...(options.restore === undefined ? {} : { restore: options.restore }),
    ...(options.initial === undefined ? {} : { initial: options.initial }),
  });
  const box = { current: LOADING_SESSION };
  const stop = context.session.subscribe((session) => {
    box.current = session;
  });
  return {
    session: () => box.current,
    settle: flush,
    unmount: stop,
  };
}

/**
 * PROJECT.md 3.3 and 7.4. Seven bindings wrap one `SessionStore`, and what a customer sees
 * must not depend on which of them they picked.
 */
describe("@idenzy/svelte", () => {
  it("satisfies the binding contract", async () => {
    const failures = await new BindingConformanceSuite().run({ name: "svelte", subject: mount });

    expect(failures).toEqual([]);
  });
});
