/**
 * The one function this package takes from Capacitor, declared rather than depended on, as
 * `@idenzy/react-native` declares Expo's: `@capacitor/core` is a peer the app already has.
 */
declare module "@capacitor/core" {
  export function registerPlugin<T>(name: string): T;
}
