/** What the native half answers a call with. It never throws: an error is a value here. */
export interface NativeAnswer {
  readonly ok?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

/**
 * The native half: `IdenzyBridge` in the Swift and Kotlin SDKs, reached through whatever a
 * framework uses to call native code. An Expo module for React Native, a native module for Lynx,
 * NativeScript's direct calls.
 *
 * One method and one stream, because the method table lives in the bridge, written once per
 * platform for every framework (ADR-0022). Errors come back as values rather than exceptions,
 * since a framework's exception carries a code and a message at best, and a screen needs the
 * status, the request id and the field details as well.
 */
export interface NativeBridge {
  call(method: string, args: Readonly<Record<string, unknown>>): Promise<NativeAnswer>;
  /** Reports the session's status on every change, until the returned function is called. */
  watchStatus(listener: (status: Readonly<Record<string, unknown>>) => void): () => void;
}
