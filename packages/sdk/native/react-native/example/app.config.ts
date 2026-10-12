import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ExpoConfig } from "expo/config";

/**
 * The smallest app that signs somebody in with Idenzy, and the place the React Native module is
 * compiled against real Expo.
 *
 * Until the native SDKs are published, the app names them where they are built: the three Swift
 * pods from this repository, and the Android SDK from the local Maven repository that
 * `./gradlew :idenzy:publishToMavenLocal` fills. Both are computed here, so no path on one machine
 * is written into the repository.
 */
const apple = resolve(__dirname, "../../apple");

const config: ExpoConfig = {
  name: "IdenzyExample",
  slug: "idenzy-react-native-example",
  version: "0.1.0",
  scheme: "io.idenzy.rnexample",
  ios: { bundleIdentifier: "io.idenzy.rnexample" },
  android: { package: "io.idenzy.rnexample" },
  plugins: [
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "16.4",
          extraPods: ["IdenzyCore", "Idenzy", "IdenzyBridge"].map((name) => ({
            name,
            path: apple,
          })),
        },
        android: {
          minSdkVersion: 26,
          extraMavenRepos: [`file://${resolve(homedir(), ".m2/repository")}`],
        },
      },
    ],
  ],
};

export default config;
