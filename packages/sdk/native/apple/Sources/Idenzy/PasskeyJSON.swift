import Foundation

/// WebAuthn's JSON forms, read for AuthenticationServices and written back from it.
///
/// The API speaks `PublicKeyCredentialCreationOptionsJSON` and `RegistrationResponseJSON`, with
/// every byte string base64url; AuthenticationServices takes and gives raw `Data`. This is the
/// translation and nothing else, so it can be tested without a sheet.
enum PasskeyJSON {
    struct Creation: Equatable {
        let relyingParty: String
        let challenge: Data
        let userID: Data
        let userName: String
        /// The user's existing credentials, so the authenticator does not enrol one twice.
        let excluded: [Data]
        let userVerification: String?
    }

    struct Request: Equatable {
        let relyingParty: String
        let challenge: Data
        let userVerification: String?
    }

    static func creation(_ json: String) throws -> Creation {
        let options = try object(json)
        guard
            let rp = options["rp"] as? [String: Any], let relyingParty = rp["id"] as? String,
            let user = options["user"] as? [String: Any], let userName = user["name"] as? String,
            let userID = bytes(user["id"]), let challenge = bytes(options["challenge"])
        else { throw malformed("creation") }
        let excluded = (options["excludeCredentials"] as? [[String: Any]] ?? []).compactMap { bytes($0["id"]) }
        let selection = options["authenticatorSelection"] as? [String: Any]
        return Creation(
            relyingParty: relyingParty,
            challenge: challenge,
            userID: userID,
            userName: userName,
            excluded: excluded,
            userVerification: selection?["userVerification"] as? String
        )
    }

    static func request(_ json: String) throws -> Request {
        let options = try object(json)
        guard let relyingParty = options["rpId"] as? String, let challenge = bytes(options["challenge"]) else {
            throw malformed("request")
        }
        return Request(relyingParty: relyingParty, challenge: challenge, userVerification: options["userVerification"] as? String)
    }

    /// `RegistrationResponseJSON`. An Apple platform passkey syncs through iCloud Keychain and can
    /// sign for another device over hybrid, which is what Safari reports for one too.
    static func registration(credentialID: Data, clientDataJSON: Data, attestationObject: Data) -> String {
        text([
            "id": base64url(credentialID),
            "rawId": base64url(credentialID),
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "response": [
                "clientDataJSON": base64url(clientDataJSON),
                "attestationObject": base64url(attestationObject),
                "transports": ["internal", "hybrid"],
            ],
        ])
    }

    /// `AuthenticationResponseJSON`.
    static func assertion(
        credentialID: Data,
        clientDataJSON: Data,
        authenticatorData: Data,
        signature: Data,
        userHandle: Data?
    ) -> String {
        var response: [String: Any] = [
            "clientDataJSON": base64url(clientDataJSON),
            "authenticatorData": base64url(authenticatorData),
            "signature": base64url(signature),
        ]
        if let userHandle { response["userHandle"] = base64url(userHandle) }
        return text([
            "id": base64url(credentialID),
            "rawId": base64url(credentialID),
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "response": response,
        ])
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func bytes(_ value: Any?) -> Data? {
        guard let text = value as? String else { return nil }
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)
    }

    private static func object(_ json: String) throws -> [String: Any] {
        guard let object = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else {
            throw malformed("options")
        }
        return object
    }

    // Built from string, Data-free dictionaries above, so serialisation cannot fail.
    private static func text(_ object: [String: Any]) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    private static func malformed(_ what: String) -> IdenzyError {
        .Transport(reason: .unexpectedResponse, detail: "The API's passkey \(what) options are not WebAuthn JSON.", status: 0)
    }
}
