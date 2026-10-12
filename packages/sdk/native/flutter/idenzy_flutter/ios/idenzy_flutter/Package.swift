// swift-tools-version: 5.9

import Foundation
import PackageDescription

// Flutter resolves plugins through symlinks under the app's ephemeral directory, so a path written
// relative to this manifest would resolve from there. The Swift SDK is found from the manifest's
// real location instead. Installed from pub.dev there is no SDK beside it, and the published one
// is the mirror, at the version this plugin was released with.
let local = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath()
    .deletingLastPathComponent() // ios/idenzy_flutter
    .deletingLastPathComponent() // ios
    .deletingLastPathComponent() // flutter/idenzy_flutter
    .deletingLastPathComponent() // flutter
    .deletingLastPathComponent() // native
    .appendingPathComponent("apple")
let developing = FileManager.default.fileExists(atPath: local.appendingPathComponent("Package.swift").path)
let swiftSDK: Package.Dependency = developing
    ? .package(name: "Idenzy", path: local.path)
    : .package(url: "https://github.com/idenzy-io/idenzy-swift.git", exact: "0.1.0")
let swiftSDKName = developing ? "Idenzy" : "idenzy-swift"

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
        swiftSDK,
    ],
    targets: [
        .target(
            name: "idenzy_flutter",
            dependencies: [
                .product(name: "FlutterFramework", package: "FlutterFramework"),
                .product(name: "IdenzyBridge", package: swiftSDKName),
            ],
            resources: [
                .process("PrivacyInfo.xcprivacy"),
            ]
        ),
    ]
)
