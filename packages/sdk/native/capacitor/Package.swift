// swift-tools-version: 5.9

import Foundation
import PackageDescription

// Capacitor reaches this package through node_modules, a symlink while it is developed here, so a
// path written relative to this manifest would resolve from there. The Swift SDK is found from the
// manifest's real location instead. Installed from npm there is no SDK beside it, and the
// published one is the mirror, at the version this package was released with.
let local = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath()
    .deletingLastPathComponent() // capacitor
    .deletingLastPathComponent() // native
    .appendingPathComponent("apple")
let developing = FileManager.default.fileExists(atPath: local.appendingPathComponent("Package.swift").path)
let swiftSDK: Package.Dependency = developing
    ? .package(name: "Idenzy", path: local.path)
    : .package(url: "https://github.com/idenzy-io/idenzy-swift.git", exact: "0.1.0")
let swiftSDKName = developing ? "Idenzy" : "idenzy-swift"

let package = Package(
    name: "IdenzyCapacitor",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "IdenzyCapacitor", targets: ["IdenzyCapacitorPlugin"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        swiftSDK,
    ],
    targets: [
        .target(
            name: "IdenzyCapacitorPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "IdenzyBridge", package: swiftSDKName),
            ],
            path: "ios/Sources/IdenzyCapacitorPlugin"
        ),
    ]
)
