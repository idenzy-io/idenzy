import { Idenzy, type IdenzyOptions } from "@idenzy/native-js";
import { type JsonCarrier, jsonBridge } from "@idenzy/native-js/json-bridge";

/**
 * Configures Idenzy for a NativeScript app, and answers with the client from `@idenzy/native-js`.
 *
 * Call it once, at start-up. `carrier` is for a test; left out, the platform's own is used, which
 * needs `@nativescript/core` and the pods or the AAR this plugin's `platforms/` declare.
 */
export async function configure(options: IdenzyOptions, carrier?: JsonCarrier): Promise<Idenzy> {
  return await Idenzy.configure(options, jsonBridge(carrier ?? (await platformCarrier())));
}

/**
 * The platform's carrier, loaded when it is first needed rather than when this file is:
 * `@nativescript/core` and the native classes exist only inside an app.
 */
async function platformCarrier(): Promise<JsonCarrier> {
  const { isIOS, Utils } = await import("@nativescript/core");
  if (isIOS) {
    const bridge = IDZBridge.shared;
    return {
      call: (method, argumentsJson, done) =>
        bridge.callMethodArgumentsJSONCompletion(method, argumentsJson, done),
      watchStatus: (report) => {
        const token = bridge.watchStatusJSON(report);
        return () => bridge.stopWatching(token);
      },
    };
  }
  const bridge = io.idenzy.bridge.JsonBridge.shared(Utils.android.getApplicationContext());
  const callback = (receive: (json: string) => void) =>
    new io.idenzy.bridge.JsonBridge.Callback({ onJson: receive });
  return {
    call: (method, argumentsJson, done) =>
      bridge.call(
        method,
        argumentsJson,
        Utils.android.getCurrentActivity() ?? null,
        callback(done),
      ),
    watchStatus: (report) => {
      const watch = bridge.watchStatus(callback(report));
      return () => watch.close();
    },
  };
}
