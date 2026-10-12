import { registerRootComponent } from "expo";
import App from "./App";
import { SelfTest } from "./self-test";

// The self-test replaces the app rather than running beside it: an app talks to one project, and
// the two configure different ones. Expo inlines the variable only when it is read this way.
registerRootComponent(process.env.EXPO_PUBLIC_IDENZY_SELF_TEST === "1" ? SelfTest : App);
