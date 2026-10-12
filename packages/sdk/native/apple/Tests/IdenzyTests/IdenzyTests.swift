import Foundation
import XCTest
@testable import Idenzy

@MainActor
final class IdenzyTests: XCTestCase {
    private let api = URL(string: "https://auth.example.test")!

    private func client(_ replies: [String: (UInt16, String)], store: MemoryStore = MemoryStore()) throws -> (Idenzy, TableTransport) {
        let transport = TableTransport(replies)
        let core = try IdenzyClient(
            config: ClientConfig(publishableKey: "pk_test_1", apiUrl: api.absoluteString, deviceName: "Ada's iPhone"),
            transport: transport,
            store: store
        )
        return (Idenzy(core: core, apiURL: api), transport)
    }

    /// Lets the main queue deliver what the core's listener queued.
    private func drain() async {
        await withCheckedContinuation { continuation in DispatchQueue.main.async { continuation.resume() } }
    }

    func testStaysLoadingUntilRestoreAnswers() async throws {
        let (idenzy, transport) = try client([:])
        await drain()
        XCTAssertEqual(idenzy.status, .loading, "a signed-in user would be shown a sign-in screen")

        try await idenzy.restore()
        XCTAssertEqual(idenzy.status, .signedOut)
        XCTAssertTrue(transport.sent.isEmpty)
    }

    func testSigningInReachesTheStatusAndTheStore() async throws {
        let store = MemoryStore()
        let (idenzy, transport) = try client(["POST v1/auth/sign-in/password": (200, Fixture.authenticated())], store: store)

        let result = try await idenzy.password.signIn(email: "ada@example.com", password: "pw")
        await drain()

        guard case let .authenticated(session) = result else { return XCTFail("expected a session") }
        XCTAssertEqual(idenzy.status, .signedIn(session.user))
        XCTAssertEqual(store.value("refresh"), "rt_first_000000000000")
        XCTAssertEqual(transport.sent.first?.headers["x-idenzy-device-name"], "Ada's%20iPhone")
        let token = try await idenzy.getToken()
        XCTAssertEqual(token, session.accessToken)
    }

    func testRestoringOfflineKeepsTheTokenAndStaysLoading() async throws {
        let store = MemoryStore()
        try store.write(key: "idenzy.pk_test_1.refresh", value: "rt_first_000000000000")
        let (idenzy, _) = try client([:], store: store)

        do {
            try await idenzy.restore()
            XCTFail("expected the transport failure")
        } catch let error as IdenzyError {
            XCTAssertEqual(error.code, .providerUnavailable)
        }
        await drain()
        XCTAssertEqual(idenzy.status, .loading)
        XCTAssertEqual(store.value("refresh"), "rt_first_000000000000")
    }

    func testANativeSignInHandsTheSheetADigestAndTheAPITheNonce() async throws {
        let expires = ISO8601DateFormatter().string(from: Date().addingTimeInterval(600))
        let (idenzy, transport) = try client([
            "POST v1/auth/id-token/nonce": (200, #"{"nonce":"server-nonce","expiresAt":"\#(expires)"}"#),
            "POST v1/auth/id-token": (200, Fixture.authenticated()),
        ])

        let prepared = try await idenzy.prepareNativeSignIn()
        XCTAssertEqual(prepared.digest.count, 64)
        XCTAssertNotEqual(prepared.digest, prepared.nonce)

        let result = try await idenzy.exchangeIdToken(.google, idToken: "google.id.token", nonce: prepared.nonce)
        guard case .authenticated = result else { return XCTFail("expected a session") }
        let body = try XCTUnwrap(transport.sent.last?.body)
        XCTAssertTrue(body.contains(#""provider":"google""#))
        XCTAssertTrue(body.contains(#""nonce":"server-nonce""#))
        XCTAssertFalse(body.contains(prepared.digest), "the digest belongs to the sheet, never to the API")
    }

    func testRefusesASecretKey() {
        XCTAssertThrowsError(
            try Idenzy.shared(publishableKey: "sk_live_1", apiURL: api)
        ) { error in
            XCTAssertEqual((error as? IdenzyError)?.code, .validationFailed)
        }
    }

    func testIsOneClientPerProject() throws {
        let first = try Idenzy.shared(publishableKey: "pk_test_shared", apiURL: api)
        let second = try Idenzy.shared(publishableKey: "pk_test_shared", apiURL: api)
        XCTAssertTrue(first === second)
        XCTAssertThrowsError(try Idenzy.shared(publishableKey: "pk_test_shared", apiURL: URL(string: "https://other.test")!))
    }
}
