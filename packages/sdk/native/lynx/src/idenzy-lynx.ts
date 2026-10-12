import { Idenzy, type IdenzyOptions } from "@idenzy/native-js";
import { IdenzyError } from "@idenzy/native-js/errors";
import type { NativeAnswer, NativeBridge } from "@idenzy/native-js/native-bridge";

/** The global event the native module sends each status on. */
export const STATUS_EVENT = "idenzy:status";

type StatusListener = (status: Readonly<Record<string, unknown>>) => void;

/** The native module as `ios/IdenzyLynxModule.m` and `IdenzyLynxModule.kt` define it. */
export interface IdenzyLynxModule {
  call(
    method: string,
    args: Readonly<Record<string, unknown>>,
    done: (answer: NativeAnswer) => void,
  ): void;
  /** Starts sending the status as `STATUS_EVENT`, now and on every change. Harmless twice. */
  watchStatus(): void;
}

/** What this package needs from a Lynx page: the module, and `GlobalEventEmitter`. */
export interface LynxHost {
  readonly module: IdenzyLynxModule;
  readonly events: {
    addListener(event: string, listener: StatusListener): void;
    removeListener(event: string, listener: StatusListener): void;
  };
}

/**
 * Configures Idenzy for a Lynx app, and answers with the client from `@idenzy/native-js`.
 *
 * Call it once, on the background thread, which is the only one with native modules: from a
 * `useEffect`, for instance. The hooks are `@idenzy/native-js/react`, which ReactLynx resolves
 * against its own React. `host` is for a test; left out, the page's own globals are used.
 */
export async function configure(options: IdenzyOptions, host?: LynxHost): Promise<Idenzy> {
  return await Idenzy.configure(options, lynxBridge(host ?? pageHost()));
}

/** The module as the shared client's `NativeBridge`: a callback becomes a promise. */
export function lynxBridge(host: LynxHost): NativeBridge {
  return {
    call: (method, args) =>
      new Promise((resolve) => {
        host.module.call(method, args, resolve);
      }),
    watchStatus: (listener) => {
      host.events.addListener(STATUS_EVENT, listener);
      host.module.watchStatus();
      return () => host.events.removeListener(STATUS_EVENT, listener);
    },
  };
}

function pageHost(): LynxHost {
  const module = typeof NativeModules === "undefined" ? undefined : NativeModules["Idenzy"];
  if (!isModule(module) || typeof lynx === "undefined") {
    throw new IdenzyError(
      "validation_failed",
      "The Idenzy native module is not registered with Lynx, or this is not the background thread.",
    );
  }
  return { module, events: lynx.getJSModule("GlobalEventEmitter") };
}

function isModule(value: unknown): value is IdenzyLynxModule {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "call") === "function" &&
    typeof Reflect.get(value, "watchStatus") === "function"
  );
}
