// swift-tools-version: 5.9

import Foundation
import PackageDescription

// Flutter resolves plugins through symlinks under the app's ephemeral directory, so a path written
// relative to this manifest would resolve from there. The Swift SDK is found from the manifest's
// real location instead. Until the SDK is published this is the repository's own copy; publishing
// swaps it for a versioned package.
let manifest = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath()
let swiftSDK = manifest
    .deletingLastPathComponent() // ios/idenzy_flutter
    .deletingLastPathComponent() // ios
    .deletingLastPathComponent() // flutter/idenzy_flutter
    .deletingLastPathComponent() // flutter
    .deletingLastPathComponent() // native
    .appendingPathComponent("apple")
    .path

// The target is `idenzy_flutter` and not `idenzy`: the Swift SDK's module is `Idenzy`, and on a
// case-insensitive disk the two would build into one directory and overwrite each other.
let package = Package(
    name: "idenzy_flutter",
    platforms: [
        .iOS("15.0"),
    ],
    products: [
        .library(name: "idenzy-flutter", targets: ["idenzy_flutter"]),
    ],
    dependencies: [
        .package(name: "FlutterFramework", path: "../FlutterFramework"),
        .package(name: "Idenzy", path: swiftSDK),
    ],
    targets: [
        .target(
            name: "idenzy_flutter",
            dependencies: [
                .product(name: "FlutterFramework", package: "FlutterFramework"),
                .product(name: "IdenzyBridge", package: "Idenzy"),
            ],
            resources: [
                .process("PrivacyInfo.xcprivacy"),
            ]
        ),
    ]
)
