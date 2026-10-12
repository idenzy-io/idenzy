import Foundation
import XCTest
@testable import Idenzy

/// The translation between the API's WebAuthn JSON and AuthenticationServices' raw bytes.
final class PasskeyJSONTests: XCTestCase {
    func testCreationOptionsAreReadIntoBytes() throws {
        let options = try PasskeyJSON.creation(#"""
        {"rp":{"id":"example.com","name":"Example"},"user":{"id":"dXNlcg","name":"ada@example.com","displayName":"Ada"},
         "challenge":"Y2hhbGxlbmdl","pubKeyCredParams":[{"type":"public-key","alg":-7}],
         "excludeCredentials":[{"id":"b2xk","type":"public-key"}],
         "authenticatorSelection":{"residentKey":"required","userVerification":"required"}}
        """#)
        XCTAssertEqual(options, PasskeyJSON.Creation(
            relyingParty: "example.com",
            challenge: Data("challenge".utf8),
            userID: Data("user".utf8),
            userName: "ada@example.com",
            excluded: [Data("old".utf8)],
            userVerification: "required"
        ))
    }

    func testRequestOptionsNameNoAccount() throws {
        let options = try PasskeyJSON.request(#"{"challenge":"Y2hhbGxlbmdl","rpId":"example.com","userVerification":"required"}"#)
        XCTAssertEqual(options, PasskeyJSON.Request(relyingParty: "example.com", challenge: Data("challenge".utf8), userVerification: "required"))
    }

    func testOptionsThatAreNotWebAuthnAreAnUnexpectedResponse() {
        XCTAssertThrowsError(try PasskeyJSON.request(#"{"rpId":"example.com"}"#)) { error in
            guard case IdenzyError.Transport(reason: .unexpectedResponse, _, _) = error else {
                return XCTFail("expected an unexpected response, got \(error)")
            }
        }
    }

    func testAnAssertionIsWrittenAsBase64urlWithoutPadding() throws {
        let json = PasskeyJSON.assertion(
            credentialID: Data([0xFB, 0xFF]),
            clientDataJSON: Data("{}".utf8),
            authenticatorData: Data([1, 2, 3]),
            signature: Data([4]),
            userHandle: Data("user".utf8)
        )
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(object["id"] as? String, "-_8")
        XCTAssertEqual(object["rawId"] as? String, "-_8")
        XCTAssertEqual(object["type"] as? String, "public-key")
        let response = try XCTUnwrap(object["response"] as? [String: Any])
        XCTAssertEqual(response["clientDataJSON"] as? String, "e30")
        XCTAssertEqual(response["signature"] as? String, "BA")
        XCTAssertEqual(response["userHandle"] as? String, "dXNlcg")
    }
}
