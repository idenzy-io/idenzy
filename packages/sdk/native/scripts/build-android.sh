#!/usr/bin/env bash
# Builds the core for Android into android/idenzy/src/main/jniLibs, and generates the Kotlin
# bindings into android/idenzy/src/main/kotlin/io/idenzy/core. Both are build output and are not
# committed (ADR-0022).
#
#   scripts/build-android.sh           release, all four ABIs, plus the host library for unit tests
#   scripts/build-android.sh --dev     debug, the bindings and the host library only: enough for
#                                      `./gradlew testDebugUnitTest` on this machine
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# minSdk. The linker is chosen per API level, so this is the floor the libraries are built for.
api=26
dev=false
[[ "${1:-}" == "--dev" ]] && dev=true
profile=$($dev && echo dev || echo release)
profile_dir=$($dev && echo debug || echo release)
module="$root/android/idenzy"

if ! $dev; then
  sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  ndk="${ANDROID_NDK_HOME:-$(ls -d "$sdk"/ndk/* 2>/dev/null | sort -V | tail -1)}"
  [[ -d "$ndk" ]] || { echo "No Android NDK found; set ANDROID_NDK_HOME." >&2; exit 1; }
  host_tag=$([[ "$(uname)" == "Darwin" ]] && echo darwin-x86_64 || echo linux-x86_64)
  toolchain="$ndk/toolchains/llvm/prebuilt/$host_tag/bin"

  # abi:rust target:clang prefix
  for entry in \
    "arm64-v8a:aarch64-linux-android:aarch64-linux-android" \
    "armeabi-v7a:armv7-linux-androideabi:armv7a-linux-androideabi" \
    "x86_64:x86_64-linux-android:x86_64-linux-android" \
    "x86:i686-linux-android:i686-linux-android"; do
    IFS=: read -r abi target clang <<<"$entry"
    rustup target add "$target" >/dev/null
    variable=$(echo "$target" | tr 'a-z-' 'A-Z_')
    export "CARGO_TARGET_${variable}_LINKER=$toolchain/${clang}${api}-clang"
    # 16 KB pages: Android 15 devices may use them, and Google Play refuses a library that is
    # aligned only for 4 KB.
    export "CARGO_TARGET_${variable}_RUSTFLAGS=-C link-arg=-Wl,-z,max-page-size=16384"
    cargo build -p idenzy-native --locked --profile "$profile" --target "$target"
    mkdir -p "$module/src/main/jniLibs/$abi"
    cp "$root/target/$target/$profile_dir/libidenzy_native.so" "$module/src/main/jniLibs/$abi/"
  done
fi

# The host's library serves twice: bindgen reads the interface from it, and the unit tests load it
# through JNA, so the Kotlin layer is tested against the real core rather than a fake of it.
cargo build -p idenzy-native --locked --profile "$profile"
host_library=""
for candidate in "$root/target/$profile_dir"/libidenzy_native.{dylib,so}; do
  [[ -f "$candidate" ]] && host_library="$candidate" && break
done
rm -rf "$module/src/main/kotlin/io/idenzy/core"
cargo run -q -p uniffi-bindgen --locked -- generate \
  --library "$host_library" --language kotlin --no-format \
  --out-dir "$module/src/main/kotlin"
mkdir -p "$module/build/host-native"
cp "$host_library" "$module/build/host-native/"
echo "android bindings, host library$($dev || echo ' and jniLibs for four ABIs') are current ($profile)"
