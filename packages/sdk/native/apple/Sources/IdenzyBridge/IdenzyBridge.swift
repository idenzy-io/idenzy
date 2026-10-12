import AuthenticationServices
import Combine
import Foundation
import Idenzy

/// A failure as every cross-platform framework receives it: a stable code, a message, and the
/// details a screen may branch on. `code` is the API's own (`invalid_credentials`), `cancelled`
/// for a sheet or browser the user closed, or `unsupported_platform`.
public struct BridgeFailure: Error {
    public let code: String
    public let message: String
    public let details: [String: Any]
}

/// The Swift SDK as one method table over plain values, for Flutter, React Native, Lynx,
/// NativeScript and Capacitor alike (ADR-0022).
///
/// Every framework moves dictionaries of strings, numbers and booleans across its own channel, so
/// the table of method names and the mapping of every record to such a dictionary are written once,
/// here, and each framework's adapter only carries messages. Timestamps cross as milliseconds since
/// the epoch, enums as their wire values. Nothing here decides anything about a session; that is
/// `Idenzy`'s, and this file only names its methods.
@MainActor
public final class IdenzyBridge {
    public static let shared = IdenzyBridge()

    private var client: Idenzy?
    /// The project `client` belongs to. A bridge serves one project for the life of the process.
    private var publishableKey: String?
    private var statusWatches: [UUID: AnyCancellable] = [:]
    private var onConfigured: [UUID: () -> Void] = [:]

    /// Challenges handed out by id, so `mfa.submit` reaches the object that can answer it.
    private var challenges: [String: MfaChallenge] = [:]

    public init() {}

    /// A bridge over a client built elsewhere, for tests.
    init(client: Idenzy, publishableKey: String) {
        self.client = client
        self.publishableKey = publishableKey
    }

    /// Calls a method by name and answers with a plain value, or throws `BridgeFailure`.
    public func call(_ method: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
        do {
            return try await dispatch(method, Arguments(values: arguments))
        } catch {
            throw Self.failure(error)
        }
    }

    /// Calls a method by name and answers with `["ok": value]` or `["error": ["code", "message",
    /// "details"]]`, never throwing. The shape every JavaScript carrier hands to
    /// `@idenzy/native-js`, written once here rather than in each of them.
    public func answer(_ method: String, _ arguments: [String: Any] = [:]) async -> [String: Any] {
        do {
            return ["ok": try await dispatch(method, Arguments(values: arguments)) ?? NSNull()]
        } catch {
            let failure = Self.failure(error)
            return ["error": ["code": failure.code, "message": failure.message, "details": failure.details]]
        }
    }

    private static func failure(_ error: Error) -> BridgeFailure {
        switch error {
        case let failure as BridgeFailure:
            return failure
        case let error as IdenzyError:
            return BridgeFailure(code: errorRawCode(error: error), message: error.detailText, details: error.details)
        case let error as ASAuthorizationError where error.code == .canceled:
            return BridgeFailure(code: "cancelled", message: error.localizedDescription, details: [:])
        case let error as ASWebAuthenticationSessionError where error.code == .canceledLogin:
            return BridgeFailure(code: "cancelled", message: error.localizedDescription, details: [:])
        default:
            return BridgeFailure(code: "internal_error", message: String(describing: error), details: [:])
        }
    }

    /// Reports the session's status now and on every change, until the returned token is passed
    /// to `stopWatching`. Starts reporting once `configure` has been called, if it has not yet.
    public func watchStatus(_ report: @escaping ([String: Any]) -> Void) -> UUID {
        let token = UUID()
        let start = { [weak self] in
            guard let self, let client = self.client else { return }
            self.statusWatches[token] = client.$status.sink { report(Self.status($0)) }
        }
        if client == nil { onConfigured[token] = start } else { start() }
        return token
    }

    public func stopWatching(_ token: UUID) {
        statusWatches[token] = nil
        onConfigured[token] = nil
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    private func dispatch(_ method: String, _ arguments: Arguments) async throws -> Any? {
        if method == "configure" {
            guard let url = URL(string: try arguments.text("apiUrl")) else {
                throw IdenzyError.Configuration(detail: "apiUrl is not a URL.")
            }
            let key = try arguments.text("publishableKey")
            // Every handle a framework holds reaches this one client, and every status watch is
            // bound to it, so a second project would take them all over without saying so.
            // Configuring the same one again, as a hot reload does, is harmless.
            if let configured = publishableKey, configured != key {
                throw IdenzyError.Configuration(
                    detail: "This app is already configured for \(configured); restart it to use \(key)."
                )
            }
            client = try Idenzy.shared(publishableKey: key, apiURL: url, deviceName: arguments.optional("deviceName"))
            publishableKey = key
            let waiting = onConfigured.values
            onConfigured = [:]
            waiting.forEach { $0() }
            return nil
        }
        guard let client else { throw IdenzyError.Configuration(detail: "Configure Idenzy first.") }

        switch method {
        case "restore": return try await client.restore().map(Self.session)
        case "getToken": return try await client.getToken()
        case "session": return client.session.map(Self.session)
        case "signOut": try await client.signOut(arguments.optional("scope") == "all" ? .all : .current)
        case "password.signIn":
            return authResult(try await client.password.signIn(email: arguments.text("email"), password: arguments.text("password")))
        case "password.signUp":
            return authResult(try await client.password.signUp(
                email: arguments.text("email"),
                password: arguments.text("password"),
                displayName: arguments.optional("displayName")
            ))
        case "password.requestReset": try await client.password.requestReset(email: arguments.text("email"))
        case "password.confirmReset":
            try await client.password.confirmReset(token: arguments.text("token"), password: arguments.text("password"))
        case "otp.startEmail": return Self.started(try await client.otp.startEmail(email: arguments.text("email")))
        case "otp.startSms":
            return Self.started(try await client.otp.startSms(phone: arguments.text("phone"), attestation: arguments.optional("attestation")))
        case "otp.verify":
            return authResult(try await client.otp.verify(code: arguments.text("code"), challengeId: arguments.optional("challengeId")))
        case "magicLink.start":
            return Self.started(try await client.magicLink.start(email: arguments.text("email"), redirectUri: arguments.text("redirectUri")))
        case "magicLink.complete":
            guard let url = URL(string: try arguments.text("url")) else { return nil }
            return try await client.completeMagicLink(url).map(authResult)
        case "oauth.signIn":
            guard let redirect = URL(string: try arguments.text("redirectUri")) else {
                throw IdenzyError.InvalidInput(detail: "redirectUri is not a URL.", fields: [])
            }
            return authResult(try await client.signInWithOAuth(provider: arguments.text("provider"), redirectURI: redirect))
        case "oauth.complete": return try await client.core.oauth().complete(url: arguments.text("url")).map(authResult)
        case "apple.signIn": return authResult(try await client.signInWithApple())
        case "google.signIn":
            throw BridgeFailure(
                code: "unsupported_platform",
                message: "There is no Sign in with Google sheet on Apple platforms. Use Google's SDK with the native sign-in exchange, or OAuth with provider 'google'.",
                details: [:]
            )
        case "idToken.prepare": return Self.nonce(try await client.prepareNativeSignIn())
        case "idToken.exchange":
            let provider: NativeProvider = try arguments.text("provider") == "apple" ? .apple : .google
            return authResult(try await client.exchangeIdToken(
                provider,
                idToken: arguments.text("idToken"),
                nonce: arguments.text("nonce"),
                displayName: arguments.optional("displayName")
            ))
        case "passkey.add": return Self.passkey(try await client.addPasskey(named: arguments.optional("name")))
        case "passkey.signIn": return authResult(try await client.signInWithPasskey())
        case "passkey.list": return try await client.passkeys.list().map(Self.passkey)
        case "passkey.remove": try await client.passkeys.remove(id: arguments.text("id"))
        case "anonymous.signIn": return authResult(try await client.anonymous.signIn())
        case "anonymous.upgrade":
            return authResult(try await client.anonymous.upgrade(email: arguments.text("email"), password: arguments.text("password")))
        case "account.me": return Self.user(try await client.account.me())
        case "account.requestEmailVerification": try await client.account.requestEmailVerification()
        case "account.confirmEmailVerification": try await client.account.confirmEmailVerification(token: arguments.text("token"))
        case "account.requestEmailChange": try await client.account.requestEmailChange(newEmail: arguments.text("newEmail"))
        case "account.confirmEmailChange":
            return ["applied": try await client.account.confirmEmailChange(token: arguments.text("token")).applied]
        case "sessions.list": return try await client.sessions.list().map(Self.sessionSummary)
        case "sessions.revoke": try await client.sessions.revoke(id: arguments.text("id"))
        case "mfa.factors":
            let list = try await client.mfa.factors()
            return ["factors": list.factors.map(Self.factor), "recoveryCodesRemaining": Int(list.recoveryCodesRemaining)]
        case "mfa.enrollTotp":
            let enrolment = try await client.mfa.enrollTotp(label: arguments.optional("label"))
            return ["factorId": enrolment.factorId, "secret": enrolment.secret, "uri": enrolment.uri]
        case "mfa.confirmTotp":
            let confirmed = try await client.mfa.confirmTotp(factorId: arguments.text("factorId"), code: arguments.text("code"))
            return ["factor": Self.factor(confirmed.factor), "recoveryCodes": confirmed.recoveryCodes.map(Self.recoveryCodes) as Any]
        case "mfa.regenerateRecoveryCodes": return Self.recoveryCodes(try await client.mfa.regenerateRecoveryCodes())
        case "mfa.removeFactor": try await client.mfa.removeFactor(factorId: arguments.text("factorId"))
        case "mfa.startStepUp": return try await client.mfa.startStepUp().map(challenge)
        case "mfa.submit":
            let id = try arguments.text("challengeId")
            guard let held = challenges[id] else {
                throw IdenzyError.InvalidInput(detail: "That challenge is not one this app started, or it is finished.", fields: [])
            }
            let code = try arguments.text("code")
            let proof: MfaProof = try arguments.text("factor") == "recovery" ? .recoveryCode(code: code) : .totp(code: code)
            let session = try await held.submit(proof: proof)
            challenges[id] = nil
            return Self.session(session)
        default:
            throw BridgeFailure(code: "unsupported_platform", message: "Unknown method \(method).", details: [:])
        }
        return nil
    }

    private func authResult(_ result: AuthResult) -> [String: Any] {
        switch result {
        case let .authenticated(session): ["status": "authenticated", "session": Self.session(session)]
        case let .mfaRequired(held): ["status": "mfa_required", "challenge": challenge(held)]
        }
    }

    private func challenge(_ held: MfaChallenge) -> [String: Any] {
        challenges[held.challengeId()] = held
        return [
            "challengeId": held.challengeId(),
            "purpose": wireMfaChallengePurpose(value: held.purpose()) as Any,
            "factors": held.factors().map { wireMfaFactorType(value: $0) as Any },
            "expiresAt": Self.millis(held.expiresAt()),
        ]
    }

    static func status(_ status: Idenzy.Status) -> [String: Any] {
        switch status {
        case .loading: ["status": "loading"]
        case .signedOut: ["status": "signedOut"]
        case let .signedIn(profile): ["status": "signedIn", "user": user(profile)]
        }
    }

    static func session(_ session: Session) -> [String: Any] {
        [
            "id": session.id,
            "user": user(session.user),
            "accessToken": session.accessToken,
            "accessTokenExpiresAt": millis(session.accessTokenExpiresAt),
        ]
    }

    static func user(_ user: User) -> [String: Any] {
        [
            "id": user.id,
            "email": user.email as Any,
            "emailVerified": user.emailVerified,
            "phone": user.phone as Any,
            "phoneVerified": user.phoneVerified,
            "displayName": user.displayName as Any,
            "avatarUrl": user.avatarUrl as Any,
            "metadataPublicJson": user.metadataPublicJson,
            "createdAt": millis(user.createdAt),
            "lastSignInAt": user.lastSignInAt.map(millis) as Any,
        ]
    }

    static func started(_ started: ChallengeStarted) -> [String: Any] {
        ["challengeId": started.challengeId, "expiresAt": millis(started.expiresAt)]
    }

    static func nonce(_ nonce: IdTokenNonce) -> [String: Any] {
        ["nonce": nonce.nonce, "digest": nonce.digest, "expiresAt": millis(nonce.expiresAt)]
    }

    static func factor(_ factor: MfaFactorSummary) -> [String: Any] {
        [
            "id": factor.id,
            "type": wireMfaFactorType(value: factor.factorType) as Any,
            "label": factor.label as Any,
            "createdAt": millis(factor.createdAt),
            "lastUsedAt": factor.lastUsedAt.map(millis) as Any,
        ]
    }

    static func passkey(_ passkey: Passkey) -> [String: Any] {
        [
            "id": passkey.id,
            "name": passkey.name as Any,
            "transports": passkey.transports,
            "backupEligible": passkey.backupEligible,
            "backedUp": passkey.backedUp,
            "createdAt": millis(passkey.createdAt),
            "lastUsedAt": passkey.lastUsedAt.map(millis) as Any,
        ]
    }

    static func recoveryCodes(_ codes: RecoveryCodes) -> [String: Any] {
        ["codes": codes.codes, "generatedAt": millis(codes.generatedAt)]
    }

    static func sessionSummary(_ row: SessionSummary) -> [String: Any] {
        [
            "id": row.id,
            "deviceName": row.deviceName as Any,
            "ip": row.ip as Any,
            "userAgent": row.userAgent as Any,
            "amr": row.amr.map { wireAuthMethod(value: $0) as Any },
            "createdAt": millis(row.createdAt),
            "lastActiveAt": millis(row.lastActiveAt),
            "absoluteExpiresAt": millis(row.absoluteExpiresAt),
            "revokedAt": row.revokedAt.map(millis) as Any,
            "revokeReason": row.revokeReason.map { wireSessionRevokeReason(value: $0) as Any } as Any,
            "current": row.current,
        ]
    }

    static func millis(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded())
    }
}

/// The call's arguments, read with the refusal a missing one deserves.
private struct Arguments {
    let values: [String: Any]

    func text(_ name: String) throws -> String {
        guard let value = values[name] as? String else {
            throw IdenzyError.InvalidInput(detail: "\(name) is required.", fields: [FieldError(path: name, code: "missing")])
        }
        return value
    }

    func optional(_ name: String) -> String? {
        values[name] as? String
    }
}

private extension IdenzyError {
    var detailText: String {
        switch self {
        case let .Api(_, _, detail, _, _, _, _),
             let .Transport(_, detail, _),
             let .MissingCredentials(detail),
             let .InvalidInput(detail, _),
             let .Configuration(detail),
             let .Redirect(_, _, detail),
             let .Storage(detail):
            detail
        }
    }

    var details: [String: Any] {
        switch self {
        case let .Api(_, _, _, status, requestId, fields, retryAfterSeconds):
            [
                "status": Int(status),
                "requestId": requestId,
                "retryAfterSeconds": retryAfterSeconds.map(Int.init) as Any,
                "fields": fields.map { ["path": $0.path, "code": $0.code] },
            ]
        case let .Transport(reason, _, status):
            ["status": Int(status), "transportReason": Self.name(of: reason)]
        case let .InvalidInput(_, fields):
            ["fields": fields.map { ["path": $0.path, "code": $0.code] }]
        default:
            [:]
        }
    }

    static func name(of reason: TransportReason) -> String {
        switch reason {
        case .notSent: "notSent"
        case .interrupted: "interrupted"
        case .unexpectedResponse: "unexpectedResponse"
        }
    }
}
