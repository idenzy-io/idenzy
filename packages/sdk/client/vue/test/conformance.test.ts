import type { Idenzy } from "@idenzy/js";
import { LOADING_SESSION } from "@idenzy/js/session/session-store";
import {
  BindingConformanceSuite,
  type MountedBinding,
  type MountOptions,
} from "@idenzy/sdk-conformance/binding-conformance";
import { flushPromises, mount as render } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { createIdenzy, useSession } from "../src/idenzy-vue.js";

/**
 * The adapter: the real plugin and the real composable, with a probe where a customer's
 * component would be. Reaching into `SessionStore` here instead would pass every case while
 * the thing a customer installs stayed broken.
 */
function mount(client: Idenzy, options: MountOptions): MountedBinding {
  const box = { current: LOADING_SESSION };
  const Probe = defineComponent({
    setup() {
      const session = useSession();
      return () => {
        box.current = session.value;
        return h("span", session.value.status);
      };
    },
  });
  const wrapper = render(Probe, {
    global: {
      plugins: [
        createIdenzy({
          client,
          ...(options.restore === undefined ? {} : { restore: options.restore }),
          ...(options.initial === undefined ? {} : { initial: options.initial }),
        }),
      ],
    },
  });
  return {
    session: () => box.current,
    settle: async () => {
      await flushPromises();
    },
    unmount: () => {
      wrapper.unmount();
    },
  };
}

/**
 * PROJECT.md 3.3 and 7.4. Seven bindings wrap one `SessionStore`, and what a customer sees
 * must not depend on which of them they picked.
 */
describe("@idenzy/vue", () => {
  it("satisfies the binding contract", async () => {
    const failures = await new BindingConformanceSuite().run({ name: "vue", subject: mount });

    expect(failures).toEqual([]);
  });
});
