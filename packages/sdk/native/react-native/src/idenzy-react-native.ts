import { Idenzy, type IdenzyOptions } from "@idenzy/native-js";
import type { NativeAnswer, NativeBridge } from "@idenzy/native-js/native-bridge";

/** The Expo module as `ios/IdenzyModule.swift` and its Kotlin twin define it. */
export interface IdenzyExpoModule {
  call(method: string, args: Readonly<Record<string, unknown>>): Promise<NativeAnswer>;
  addListener(
    event: "onStatus",
    listener: (status: Readonly<Record<string, unknown>>) => void,
  ): { remove(): void };
}

/**
 * Configures Idenzy for a React Native or Expo app, and answers with the client from
 * `@idenzy/native-js`. Call it once, at start-up; the hooks are `@idenzy/native-js/react`.
 *
 * `expo` is for a test that brings its own module. Left out, the app's is loaded here rather than
 * when this file is: `expo-modules-core` exists only inside an app.
 */
export async function configure(options: IdenzyOptions, expo?: IdenzyExpoModule): Promise<Idenzy> {
  return Idenzy.configure(options, expoBridge(expo ?? (await appModule())));
}

/** The Expo module as the shared client's `NativeBridge`: the event becomes a watch. */
export function expoBridge(expo: IdenzyExpoModule): NativeBridge {
  return {
    call: (method, args) => expo.call(method, args),
    watchStatus: (listener) => {
      const subscription = expo.addListener("onStatus", listener);
      return () => subscription.remove();
    },
  };
}

async function appModule(): Promise<IdenzyExpoModule> {
  const { requireNativeModule } = await import("expo-modules-core");
  return requireNativeModule<IdenzyExpoModule>("Idenzy");
}
