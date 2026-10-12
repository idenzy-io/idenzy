import Foundation
import Security
import XCTest
@testable import Idenzy

final class KeychainStoreTests: XCTestCase {
    private var service = ""
    private var defaults: UserDefaults!

    override func setUpWithError() throws {
        // The data-protection keychain needs an entitlement that no SwiftPM test bundle has, on
        // macOS or in the simulator. The file keychain exercises the same queries; on iOS there
        // is nothing to run them against without an app to host the tests.
        #if !os(macOS)
        throw XCTSkip("Needs a keychain entitlement, which a SwiftPM test bundle cannot have.")
        #endif
        service = "io.idenzy.tests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: service)
    }

    private func store() -> KeychainStore {
        KeychainStore(service: service, defaults: defaults, dataProtection: false)
    }

    override func tearDown() {
        try? store().remove(key: "refresh")
        defaults?.removePersistentDomain(forName: service)
    }

    func testRoundTripsAndForgets() throws {
        let store = store()
        XCTAssertNil(try store.read(key: "refresh"))
        try store.write(key: "refresh", value: "rt_1")
        try store.write(key: "refresh", value: "rt_2")
        XCTAssertEqual(try store.read(key: "refresh"), "rt_2")
        try store.remove(key: "refresh")
        try store.remove(key: "refresh")
        XCTAssertNil(try store.read(key: "refresh"))
    }

    func testAReinstallForgetsWhatTheLastInstallStored() throws {
        try store().write(key: "refresh", value: "rt_1")
        XCTAssertEqual(try store().read(key: "refresh"), "rt_1")

        // Deleting the app deletes its defaults and leaves its keychain items.
        defaults.removePersistentDomain(forName: service)
        XCTAssertNil(try store().read(key: "refresh"))
    }
}
