/**
 * What this package reads from NativeScript and from the native SDKs, declared rather than
 * depended on.
 *
 * `@nativescript/core` is a peer the app already has, and installing it here would bring
 * NativeScript into the workspace's lockfile for three signatures, the trade
 * `@idenzy/react-native` declines for Expo. The native classes are the ones NativeScript's
 * metadata exposes as globals: `IDZBridge` from the Swift SDK, `io.idenzy.bridge.JsonBridge` from
 * the Android one. None of it is emitted with the types.
 */
declare module "@nativescript/core" {
  export const isIOS: boolean;
  export namespace Utils {
    namespace android {
      function getApplicationContext(): unknown;
      function getCurrentActivity(): unknown;
    }
  }
}

declare class IDZBridge {
  static readonly shared: IDZBridge;
  callMethodArgumentsJSONCompletion(
    method: string,
    argumentsJSON: string,
    completion: (json: string) => void,
  ): void;
  watchStatusJSON(report: (json: string) => void): string;
  stopWatching(token: string): void;
}

declare namespace io.idenzy.bridge {
  class JsonBridge {
    static shared(context: unknown): JsonBridge;
    call(method: string, argumentsJson: string, activity: unknown, done: JsonBridge.Callback): void;
    watchStatus(report: JsonBridge.Callback): { close(): void };
  }
  namespace JsonBridge {
    class Callback {
      constructor(implementation: { onJson(json: string): void });
    }
  }
}
