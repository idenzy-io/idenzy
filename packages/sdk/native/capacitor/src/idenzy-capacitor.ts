import { Idenzy, type IdenzyOptions } from "@idenzy/native-js";
import { type JsonCarrier, jsonBridge } from "@idenzy/native-js/json-bridge";

/** The Capacitor plugin as `IdenzyPlugin.swift` and `IdenzyPlugin.kt` define it. */
export interface IdenzyCapacitorPlugin {
  call(options: { method: string; arguments: string }): Promise<{ json: string }>;
  addListener(
    event: "status",
    listener: (event: { json: string }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

/**
 * Configures Idenzy for a Capacitor app, and answers with the client from `@idenzy/native-js`.
 *
 * Call it once, at start-up. The session lives in the native SDK, not in the web view: the refresh
 * token is in the Keychain or the Keystore, where the page's scripts cannot read it. `plugin` is
 * for a test; left out, the app's is used.
 */
export async function configure(
  options: IdenzyOptions,
  plugin?: IdenzyCapacitorPlugin,
): Promise<Idenzy> {
  const carrier = plugin === undefined ? await appCarrier() : capacitorCarrier(plugin);
  return await Idenzy.configure(options, jsonBridge(carrier));
}

/** The plugin as a JSON carrier: Capacitor's promise and listener handle become a callback. */
export function capacitorCarrier(plugin: IdenzyCapacitorPlugin): JsonCarrier {
  return {
    call: (method, argumentsJson, done) => {
      plugin.call({ method, arguments: argumentsJson }).then(
        (answer) => done(answer.json),
        // The plugin answers every call with JSON, a refusal included; a rejection is Capacitor's.
        (error: unknown) =>
          done(
            JSON.stringify({
              error: { code: "internal_error", message: String(error), details: {} },
            }),
          ),
      );
    },
    watchStatus: (report) => {
      const handle = plugin.addListener("status", (event) => report(event.json));
      return () => {
        void handle.then((listener) => listener.remove());
      };
    },
  };
}

type CapacitorCore = { registerPlugin<T>(name: string): T };

/**
 * The app's plugin as a carrier, loaded when it is first needed rather than when this file is:
 * `@capacitor/core` exists only inside an app. `load` is for a test.
 *
 * Wrapped before it leaves: Capacitor's plugin object is a proxy that answers every property as a
 * method, `then` included, so a promise resolved with the plugin itself calls a native method named
 * `then`, which rejects, and `configure` never gets past it.
 */
export async function appCarrier(
  load: () => Promise<CapacitorCore> = () => import("@capacitor/core"),
): Promise<JsonCarrier> {
  const { registerPlugin } = await load();
  return capacitorCarrier(registerPlugin<IdenzyCapacitorPlugin>("Idenzy"));
}
