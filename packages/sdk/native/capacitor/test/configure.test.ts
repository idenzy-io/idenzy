import { describe, expect, it } from "vitest";
import { appCarrier, configure, type IdenzyCapacitorPlugin } from "../src/idenzy-capacitor.js";

/** The plugin as the Swift and Kotlin halves answer, recording what JavaScript asked. */
class FakePlugin implements IdenzyCapacitorPlugin {
  readonly calls: { method: string; arguments: string }[] = [];
  readonly listeners = new Set<(event: { json: string }) => void>();

  constructor(private readonly answer: (method: string) => Promise<{ json: string }>) {}

  call(options: { method: string; arguments: string }): Promise<{ json: string }> {
    this.calls.push(options);
    return this.answer(options.method);
  }

  addListener(_event: "status", listener: (event: { json: string }) => void) {
    this.listeners.add(listener);
    return Promise.resolve({
      remove: () => {
        this.listeners.delete(listener);
        return Promise.resolve();
      },
    });
  }
}

const options = { publishableKey: "pk_test_1", apiUrl: "https://auth.example.test" };
const ok = () => Promise.resolve({ json: '{"ok":null}' });

describe("the Capacitor carrier", () => {
  it("configures the native SDK through the plugin, in JSON", async () => {
    const plugin = new FakePlugin(ok);
    await configure(options, plugin);
    expect(plugin.calls).toEqual([
      {
        method: "configure",
        arguments:
          '{"publishableKey":"pk_test_1","apiUrl":"https://auth.example.test","deviceName":null}',
      },
    ]);
  });

  it("carries the plugin's status event to the client", async () => {
    const plugin = new FakePlugin(ok);
    const client = await configure(options, plugin);
    for (const listener of plugin.listeners) listener({ json: '{"status":"signedOut"}' });
    expect(client.status.status).toBe("signedOut");
  });

  it("turns a rejected plugin call into an error rather than a promise that never settles", async () => {
    const plugin = new FakePlugin((method) =>
      method === "configure" ? ok() : Promise.reject(new Error("plugin not implemented")),
    );
    const client = await configure(options, plugin);
    await expect(client.getToken()).rejects.toMatchObject({ rawCode: "internal_error" });
  });

  it("hands over the app's plugin wrapped, since Capacitor's answers `then` like any method", async () => {
    // A proxy as Capacitor builds one: every property is a plugin method, and an unknown one rejects.
    const fake = new FakePlugin(ok);
    const plugin = new Proxy(fake, {
      get: (target, property) =>
        property === "call" || property === "addListener"
          ? Reflect.get(target, property).bind(target)
          : () => Promise.reject(new Error(`"Idenzy.${String(property)}()" is not implemented`)),
    });
    const carrier = await appCarrier(() =>
      // Capacitor's registerPlugin is generic in a type it cannot check either; the proxy stands in.
      Promise.resolve({ registerPlugin: <T>() => plugin as unknown as T }),
    );

    const answer = await new Promise<string>((done) => carrier.call("session", "{}", done));
    expect(answer).toBe('{"ok":null}');
  });
});
