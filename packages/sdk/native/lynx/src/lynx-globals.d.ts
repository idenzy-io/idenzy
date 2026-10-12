/**
 * The two background-thread globals this package reads, declared rather than depended on.
 *
 * Declared here and not taken from `@lynx-js/types`, so an app's own `NativeModules` declaration,
 * the one Lynx asks every app to write, is the only one it sees. Neither is emitted with the types.
 */
declare const NativeModules: Readonly<Record<string, unknown>> | undefined;

declare const lynx:
  | {
      getJSModule(name: "GlobalEventEmitter"): import("./idenzy-lynx.js").LynxHost["events"];
    }
  | undefined;
