import Foundation
import XCTest
@testable import Idenzy
@testable import IdenzyBridge

/// The method table every framework plugin sits on: names in, plain values out.
@MainActor
final class IdenzyBridgeTests: XCTestCase {
    private func bridge(_ replies: [String: (UInt16, String)]) throws -> (IdenzyBridge, TableTransport) {
        let transport = TableTransport(replies)
        let api = URL(string: "https://auth.example.test")!
        let core = try IdenzyClient(
            config: ClientConfig(publishableKey: "pk_test_1", apiUrl: api.absoluteString, deviceName: nil),
            transport: transport,
            store: MemoryStore()
        )
        return (IdenzyBridge(client: Idenzy(core: core, apiURL: api), publishableKey: "pk_test_1"), transport)
    }

    func testASignInAnswersWithPlainValuesAFrameworkCanCarry() async throws {
        let (bridge, _) = try bridge(["POST v1/auth/sign-in/password": (200, Fixture.authenticated())])

        let answer = try await bridge.call("password.signIn", ["email": "ada@example.com", "password": "pw"])

        let result = try XCTUnwrap(answer as? [String: Any])
        XCTAssertEqual(result["status"] as? String, "authenticated")
        let session = try XCTUnwrap(result["session"] as? [String: Any])
        let user = try XCTUnwrap(session["user"] as? [String: Any])
        XCTAssertEqual(user["email"] as? String, "ada@example.com")
        XCTAssertEqual(user["createdAt"] as? Int64, 1_791_702_000_000)
    }

    func testARefusalCrossesAsTheAPIsOwnCode() async throws {
        let refusal = #"{"error":{"code":"invalid_credentials","message":"No.","requestId":"req_1"}}"#
        let (bridge, _) = try bridge(["POST v1/auth/sign-in/password": (401, refusal)])
        do {
            _ = try await bridge.call("password.signIn", ["email": "ada@example.com", "password": "wrong"])
            XCTFail("expected a refusal")
        } catch let failure as BridgeFailure {
            XCTAssertEqual(failure.code, "invalid_credentials")
            XCTAssertEqual(failure.details["status"] as? Int, 401)
            XCTAssertEqual(failure.details["requestId"] as? String, "req_1")
        }
    }

    func testAMissingArgumentIsRefusedBeforeAnythingIsSent() async throws {
        let (bridge, transport) = try bridge([:])
        do {
            _ = try await bridge.call("password.signIn", ["email": "ada@example.com"])
            XCTFail("expected a refusal")
        } catch let failure as BridgeFailure {
            XCTAssertEqual(failure.code, "validation_failed")
        }
        XCTAssertTrue(transport.sent.isEmpty)
    }

    func testASecondProjectIsRefusedRatherThanTakingOverTheFirst() async throws {
        let (bridge, transport) = try bridge([:])
        do {
            _ = try await bridge.call("configure", ["publishableKey": "pk_test_2", "apiUrl": "https://auth.example.test"])
            XCTFail("expected a refusal")
        } catch let failure as BridgeFailure {
            XCTAssertEqual(failure.code, "validation_failed")
            XCTAssertTrue(failure.message.contains("pk_test_1"))
        }
        XCTAssertTrue(transport.sent.isEmpty)
    }

    func testAnAnswerCarriesAFailureAsAValueWithItsDetails() async throws {
        let (bridge, _) = try bridge([:])
        let answer = await bridge.answer("password.signIn", ["email": "ada@example.com"])
        let error = try XCTUnwrap(answer["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "validation_failed")
        XCTAssertNotNil(error["details"] as? [String: Any])
        XCTAssertNil(answer["ok"])
    }

    func testTheObjectiveCFacadeAnswersOnceWithTheSameValue() async throws {
        let (bridge, _) = try bridge(["POST v1/auth/sign-in/password": (200, Fixture.authenticated())])
        let facade = ObjCBridge(bridge: bridge)
        let status = await withCheckedContinuation { (done: CheckedContinuation<String?, Never>) in
            facade.call("password.signIn", arguments: ["email": "ada@example.com", "password": "pw"]) { answer in
                done.resume(returning: (answer["ok"] as? [String: Any])?["status"] as? String)
            }
        }
        XCTAssertEqual(status, "authenticated")
    }

    func testAnUnknownMethodIsUnsupportedRatherThanIgnored() async throws {
        let (bridge, _) = try bridge([:])
        do {
            _ = try await bridge.call("password.teleport")
            XCTFail("expected a refusal")
        } catch let failure as BridgeFailure {
            XCTAssertEqual(failure.code, "unsupported_platform")
        }
    }
}
