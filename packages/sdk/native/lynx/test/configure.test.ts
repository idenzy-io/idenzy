import type { NativeAnswer } from "@idenzy/native-js/native-bridge";
import { describe, expect, it } from "vitest";
import {
  configure,
  type IdenzyLynxModule,
  type LynxHost,
  STATUS_EVENT,
} from "../src/idenzy-lynx.js";

type Listener = (status: Readonly<Record<string, unknown>>) => void;

/** A Lynx page as the native module and `GlobalEventEmitter` behave, recording what was asked. */
class FakePage implements LynxHost {
  readonly calls: { method: string; args: Readonly<Record<string, unknown>> }[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  /** Whether a listener was attached when the module was asked to start, or null if never asked. */
  listeningWhenAsked: boolean | null = null;

  readonly module: IdenzyLynxModule = {
    call: (method, args, done: (answer: NativeAnswer) => void) => {
      this.calls.push({ method, args });
      done({ ok: null });
    },
    watchStatus: () => {
      this.listeningWhenAsked = (this.listeners.get(STATUS_EVENT)?.size ?? 0) > 0;
    },
  };

  readonly events = {
    addListener: (event: string, listener: Listener) => {
      const set = this.listeners.get(event) ?? new Set();
      set.add(listener);
      this.listeners.set(event, set);
    },
    removeListener: (event: string, listener: Listener) => {
      this.listeners.get(event)?.delete(listener);
    },
  };

  send(status: Readonly<Record<string, unknown>>): void {
    for (const listener of this.listeners.get(STATUS_EVENT) ?? []) listener(status);
  }
}

const options = { publishableKey: "pk_test_1", apiUrl: "https://auth.example.test" };

describe("the Lynx carrier", () => {
  it("configures the native SDK through the module's callback", async () => {
    const page = new FakePage();
    await configure(options, page);
    expect(page.calls).toEqual([
      {
        method: "configure",
        args: {
          publishableKey: "pk_test_1",
          apiUrl: "https://auth.example.test",
          deviceName: null,
        },
      },
    ]);
  });

  it("listens before it asks the module to start sending", async () => {
    const page = new FakePage();
    const client = await configure(options, page);
    expect(page.listeningWhenAsked).toBe(true);

    page.send({ status: "signedOut" });
    expect(client.status.status).toBe("signedOut");
  });

  it("refuses to start outside a Lynx page instead of failing on a missing global", async () => {
    await expect(configure(options)).rejects.toMatchObject({ code: "validation_failed" });
  });
});
