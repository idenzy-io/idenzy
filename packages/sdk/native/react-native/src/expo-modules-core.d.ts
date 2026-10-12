/**
 * The one function this package takes from Expo, declared rather than depended on.
 *
 * `expo-modules-core` is a peer the app already has, and installing it here would bring React
 * Native into the workspace's lockfile for a single signature, which is the trade the SvelteKit,
 * Astro and Remix helpers decline for the same reason (docs/guide/sdk.md).
 */
declare module "expo-modules-core" {
  export function requireNativeModule<T>(name: string): T;
}
