import type { Idenzy } from "@idenzy/js";
import {
  BindingConformanceSuite,
  type MountedBinding,
  type MountOptions,
} from "@idenzy/sdk-conformance/binding-conformance";
import { describe, expect, it } from "vitest";
import { IdenzySession } from "../src/idenzy-angular.js";

/** Long enough for the transport, the parse and the publish behind a restore. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * The adapter: the class a component injects, built and destroyed the way `provideIdenzy`
 * builds and destroys it. The provider itself is a factory and a `DestroyRef` hook, which is
 * where `session.test.ts` looks; everything a case here asks about lives in this class.
 */
function mount(client: Idenzy, options: MountOptions): MountedBinding {
  const state = new IdenzySession(client, {
    ...(options.restore === undefined ? {} : { restore: options.restore }),
    ...(options.initial === undefined ? {} : { initial: options.initial }),
  });
  return {
    session: () => state.session(),
    settle: flush,
    unmount: () => {
      state.destroy();
    },
  };
}

/**
 * PROJECT.md 3.3 and 7.4. Seven bindings wrap one `SessionStore`, and what a customer sees
 * must not depend on which of them they picked.
 */
describe("@idenzy/angular", () => {
  it("satisfies the binding contract", async () => {
    const failures = await new BindingConformanceSuite().run({ name: "angular", subject: mount });

    expect(failures).toEqual([]);
  });
});
