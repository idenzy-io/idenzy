#!/usr/bin/env bash
# Packages a release build of the Swift SDK for distribution (docs/guide/native.md, "Releasing").
# Run scripts/build-apple.sh first; this takes what it left in apple/ and writes target/apple-release:
#
#   IdenzyCoreFFI.xcframework.zip    the binary target the SwiftPM mirror downloads, and its checksum
#   idenzy-apple-<version>.zip       apple/ as the three podspecs read it: the generated and written
#                                    sources and the XCFramework, for their :http source
#   swift-package/                   the mirror repository's contents: a Package.swift naming the
#                                    binary by URL and checksum, and the sources beside it
#
# The zips go on the GitHub release v<version>, which is where both point. SwiftPM needs
# Package.swift at a repository's root, so the package is a mirror rather than this repository.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
version="$(node -p "require('./js/package.json').version")"
release="https://github.com/idenzy-io/idenzy/releases/download/v$version"
out="$root/target/apple-release"

if [[ ! -d apple/IdenzyCoreFFI.xcframework || ! -f apple/Sources/IdenzyCore/IdenzyCore.swift ]]; then
  echo "No build in apple/: run scripts/build-apple.sh first." >&2
  exit 1
fi
# A development build has the macOS slice alone, and publishing one strands every iOS app.
for slice in ios-arm64 ios-arm64_x86_64-simulator; do
  if [[ ! -d "apple/IdenzyCoreFFI.xcframework/$slice" ]]; then
    echo "apple/IdenzyCoreFFI.xcframework has no $slice: run scripts/build-apple.sh without --dev." >&2
    exit 1
  fi
done

rm -rf "$out"
mkdir -p "$out"

# ditto keeps the framework's symlinks and attributes, which zip would flatten.
(cd apple && ditto -c -k --sequesterRsrc --keepParent IdenzyCoreFFI.xcframework "$out/IdenzyCoreFFI.xcframework.zip")
checksum="$(swift package compute-checksum "$out/IdenzyCoreFFI.xcframework.zip")"

stage="$out/pods"
mkdir -p "$stage"
cp -R apple/Sources apple/IdenzyCoreFFI.xcframework "$stage/"
cp LICENSE "$stage/"
(cd "$stage" && zip -qry "$out/idenzy-apple-$version.zip" .)

mirror="$out/swift-package"
mkdir -p "$mirror"
cp -R apple/Sources "$mirror/"
cp LICENSE "$mirror/"
# apple/Package.swift with the binary target pointing at the release instead of a local path, and
# without the test target, whose sources stay here.
python3 - "$root/apple/Package.swift" "$mirror/Package.swift" "$release" "$checksum" <<'PY'
import re, sys
source, target, release, checksum = sys.argv[1:]
text = open(source).read()
binary = '.binaryTarget(name: "IdenzyCoreFFI", path: "IdenzyCoreFFI.xcframework")'
if binary not in text:
    sys.exit("apple/Package.swift no longer declares the binary target this script rewrites.")
text = text.replace(
    binary,
    f'.binaryTarget(\n            name: "IdenzyCoreFFI",\n'
    f'            url: "{release}/IdenzyCoreFFI.xcframework.zip",\n'
    f'            checksum: "{checksum}"\n        )',
)
text, tests = re.subn(r'\n\s*\.testTarget\([^)]*\),', "", text)
if tests != 1:
    sys.exit("apple/Package.swift no longer has the one test target this script drops.")
header = "// Generated from github.com/idenzy-io/idenzy (packages/sdk/native/apple) by\n// scripts/package-apple.sh for each release. Change it there, not here.\n"
open(target, "w").write(text.replace("import PackageDescription", header + "\nimport PackageDescription", 1))
PY

echo "target/apple-release for v$version: IdenzyCoreFFI.xcframework.zip ($checksum), idenzy-apple-$version.zip, swift-package/"
