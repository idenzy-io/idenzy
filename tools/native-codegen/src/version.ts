import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every line in the native tree that states the SDK's version, and how to find it.
 *
 * One version for everything, the one Changesets gives `@idenzy/native-js` and its fixed group:
 * the Maven artifacts, the pods and the pub package are the same release as the npm packages
 * that load them, and a React Native module asking Maven for an Android SDK one version behind
 * its own would be a release that installs and then fails at the first call.
 *
 * Each pattern keeps what surrounds the version in its first and last groups, and must match
 * exactly once: a line that moved fails the generator rather than being skipped, which is what
 * would let a stale version ship.
 */
const VERSIONED: readonly { readonly path: string; readonly patterns: readonly RegExp[] }[] = [
  { path: "Cargo.toml", patterns: [/^(version = ")[^"]+(")$/m] },
  {
    path: "Cargo.lock",
    patterns: [
      /(name = "idenzy-native"\nversion = ")[^"]+(")/,
      /(name = "uniffi-bindgen"\nversion = ")[^"]+(")/,
    ],
  },
  {
    path: "android/idenzy/build.gradle.kts",
    patterns: [/(artifactId = "idenzy-android"\n\s*version = ")[^"]+(")/],
  },
  {
    path: "lynx/android/build.gradle.kts",
    patterns: [/(artifactId = "idenzy-lynx"\n\s*version = ")[^"]+(")/],
  },
  { path: "apple/IdenzyCore.podspec", patterns: [/(s\.version = ')[^']+(')/] },
  { path: "apple/Idenzy.podspec", patterns: [/(s\.version = ')[^']+(')/] },
  { path: "apple/IdenzyBridge.podspec", patterns: [/(s\.version = ')[^']+(')/] },
  { path: "capacitor/android/build.gradle", patterns: [/('io\.idenzy:idenzy-android:)[^']+(')/] },
  {
    path: "flutter/idenzy_flutter/android/build.gradle.kts",
    patterns: [/^(version = ")[^"]+(")$/m, /("io\.idenzy:idenzy-android:)[^"]+(")/],
  },
  { path: "flutter/idenzy_flutter/pubspec.yaml", patterns: [/^(version: )\S+()$/m] },
  {
    path: "nativescript/platforms/android/include.gradle",
    patterns: [/('io\.idenzy:idenzy-android:)[^']+(')/],
  },
  { path: "nativescript/platforms/ios/Podfile", patterns: [/(pod 'IdenzyBridge', ')[^']+(')/] },
  {
    path: "react-native/android/build.gradle",
    patterns: [
      /^(version = ')[^']+(')$/m,
      /(versionName ')[^']+(')/,
      /('io\.idenzy:idenzy-android:)[^']+(')/,
    ],
  },
  // The mirror an installed plugin falls back to, when the Swift SDK is not beside it.
  { path: "capacitor/Package.swift", patterns: [/(idenzy-swift\.git", exact: ")[^"]+(")/] },
  {
    path: "flutter/idenzy_flutter/ios/idenzy_flutter/Package.swift",
    patterns: [/(idenzy-swift\.git", exact: ")[^"]+(")/],
  },
  {
    path: "lynx/example/android/app/build.gradle.kts",
    patterns: [/("io\.idenzy:idenzy-lynx:)[^"]+(")/],
  },
];

/** The version Changesets gave the fixed group, read from the package every carrier loads. */
export function sdkVersion(native: string): string {
  const manifest: unknown = JSON.parse(readFileSync(join(native, "js", "package.json"), "utf8"));
  const version =
    typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "version") : null;
  if (typeof version !== "string" || version === "") {
    fail("packages/sdk/native/js/package.json has no version.");
  }
  return version;
}

/** The files to rewrite, each with what to do to its current text. */
export function versionTargets(
  native: string,
): readonly { readonly path: string; readonly render: (existing: string) => string }[] {
  const version = sdkVersion(native);
  return VERSIONED.map(({ path, patterns }) => ({
    path: join(native, path),
    render: (existing: string) =>
      patterns.reduce((text, pattern) => {
        const found = text.match(new RegExp(pattern.source, `${pattern.flags}g`))?.length ?? 0;
        if (found !== 1) {
          fail(`${path}: expected one match for ${pattern}, found ${found}.`);
        }
        return text.replace(pattern, (_match, before: string, after: string) => {
          return `${before}${version}${after}`;
        });
      }, existing),
  }));
}

/** Stops the generator the way its main does: a CLI's failure is a message and an exit code. */
function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
