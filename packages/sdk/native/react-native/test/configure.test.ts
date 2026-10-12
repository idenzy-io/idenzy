import { describe, expect, it } from "vitest";
import { configure, type IdenzyExpoModule } from "../src/idenzy-react-native.js";

/** The Expo module as the Swift and Kotlin halves answer, recording what JavaScript asked. */
class FakeExpoModule implements IdenzyExpoModule {
  readonly calls: { method: string; args: Readonly<Record<string, unknown>> }[] = [];
  readonly listeners = new Set<(status: Readonly<Record<string, unknown>>) => void>();

  call(method: string, args: Readonly<Record<string, unknown>>) {
    this.calls.push({ method, args });
    return Promise.resolve({ ok: null });
  }

  addListener(_event: "onStatus", listener: (status: Readonly<Record<string, unknown>>) => void) {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }
}

describe("the Expo carrier", () => {
  it("configures the native SDK through the module", async () => {
    const expo = new FakeExpoModule();
    await configure({ publishableKey: "pk_test_1", apiUrl: "https://auth.example.test" }, expo);
    expect(expo.calls).toEqual([
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

  it("carries the module's status event to the client", async () => {
    const expo = new FakeExpoModule();
    const client = await configure(
      { publishableKey: "pk_test_1", apiUrl: "https://auth.example.test" },
      expo,
    );
    for (const listener of expo.listeners) listener({ status: "signedOut" });
    expect(client.status.status).toBe("signedOut");
  });
});
