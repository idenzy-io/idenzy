#!/usr/bin/env bash
# Builds the core for Apple platforms into apple/IdenzyCoreFFI.xcframework, and generates the Swift
# bindings into apple/Sources/IdenzyCore. Both are build output and are not committed (ADR-0022).
#
#   scripts/build-apple.sh             release, every slice: iOS, iOS simulator, macOS
#   scripts/build-apple.sh --dev       debug, macOS only: enough for `swift test` on this machine
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

profile=release
slices=(ios simulator macos)
if [[ "${1:-}" == "--dev" ]]; then
  profile=dev
  slices=(macos)
fi
profile_dir=$([[ "$profile" == "dev" ]] && echo debug || echo release)

# A function rather than an associative array: macOS ships bash 3.2, which has none.
targets_for() {
  case "$1" in
    ios) echo "aarch64-apple-ios" ;;
    simulator) echo "aarch64-apple-ios-sim x86_64-apple-ios" ;;
    macos) echo "aarch64-apple-darwin x86_64-apple-darwin" ;;
  esac
}

build_dir="$root/target/apple"
rm -rf "$build_dir"
mkdir -p "$build_dir"

for slice in "${slices[@]}"; do
  libraries=()
  for target in $(targets_for "$slice"); do
    rustup target add "$target" >/dev/null
    cargo build -p idenzy-native --locked --profile "$profile" --target "$target"
    libraries+=("$root/target/$target/$profile_dir/libidenzy_native.a")
  done
  mkdir -p "$build_dir/$slice"
  # One fat library per slice: an XCFramework holds one library per platform variant, so the two
  # simulator and the two macOS architectures are merged before it sees them.
  lipo -create "${libraries[@]}" -output "$build_dir/$slice/libidenzy_native.a"
done

# Bindings come from the host's dynamic library: library mode reads the interface from it, and the
# interface is the same for every target.
cargo build -p idenzy-native --locked --profile "$profile"
cargo run -q -p uniffi-bindgen --locked -- generate \
  --library "$root/target/$profile_dir/libidenzy_native.dylib" \
  --language swift --out-dir "$build_dir/bindings"

# The module map sits in its own directory under Headers. At the top level it collides with any
# other XCFramework in the same app that did the same, and Xcode refuses the build.
headers="$build_dir/headers/IdenzyCoreFFI"
mkdir -p "$headers"
cp "$build_dir/bindings/IdenzyCoreFFI.h" "$headers/"
cp "$build_dir/bindings/IdenzyCoreFFI.modulemap" "$headers/module.modulemap"

arguments=()
for slice in "${slices[@]}"; do
  arguments+=(-library "$build_dir/$slice/libidenzy_native.a" -headers "$build_dir/headers")
done
rm -rf "$root/apple/IdenzyCoreFFI.xcframework"
xcodebuild -create-xcframework "${arguments[@]}" -output "$root/apple/IdenzyCoreFFI.xcframework" >/dev/null

mkdir -p "$root/apple/Sources/IdenzyCore"
cp "$build_dir/bindings/IdenzyCore.swift" "$root/apple/Sources/IdenzyCore/IdenzyCore.swift"
echo "apple/IdenzyCoreFFI.xcframework (${slices[*]}, $profile) and apple/Sources/IdenzyCore are current"
