// Metro, told about the directories outside this app that it bundles from: this package, linked as
// `file:..`, the shared client in `../../js`, and the workspace's `@idenzy/protocol` they depend on.
//
// Those three and not the workspace root. Metro resolves only files it watches, which is why
// `react` from `../../js` falls through to this app's copy rather than the workspace's development
// copy under `node_modules/.pnpm`. Watch the root and both are bundled, and two Reacts fail every
// hook.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
const pkg = path.resolve(__dirname, "..");
const shared = path.resolve(pkg, "../js");
const workspace = path.resolve(pkg, "../../../..");

config.watchFolders = [pkg, shared, path.join(workspace, "packages/protocol")];
config.resolver.nodeModulesPaths = [
  path.join(__dirname, "node_modules"),
  path.join(pkg, "node_modules"),
  path.join(shared, "node_modules"),
];

module.exports = config;
