// swift-tools-version: 5.9

import Foundation
import PackageDescription

// Capacitor reaches this package through node_modules, a symlink while it is developed here, so a
// path written relative to this manifest would resolve from there. The Swift SDK is found from the
// manifest's real location instead. Publishing swaps it for a versioned package.
let swiftSDK = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath()
    .deletingLastPathComponent() // capacitor
    .deletingLastPathComponent() // native
    .appendingPathComponent("apple")
    .path

let package = Package(
    name: "IdenzyCapacitor",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "IdenzyCapacitor", targets: ["IdenzyCapacitorPlugin"]),
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(name: "Idenzy", path: swiftSDK),
    ],
    targets: [
        .target(
            name: "IdenzyCapacitorPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "IdenzyBridge", package: "Idenzy"),
            ],
            path: "ios/Sources/IdenzyCapacitorPlugin"
        ),
    ]
)
