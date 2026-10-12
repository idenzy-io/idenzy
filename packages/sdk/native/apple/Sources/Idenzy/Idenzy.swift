import AuthenticationServices
import Foundation
@_exported import IdenzyCore

/// The client an app holds: every way in, the session as a status SwiftUI can observe, and the
/// system-browser half of OAuth. There is no UI in it (ADR-0002); the screens are the app's.
///
/// One per project per process, which is why it is obtained from `shared` rather than built. Two
/// clients over one Keychain would rotate the same refresh token independently, and the second
/// rotation revokes the session (ADR-0007).
@MainActor
public final class Idenzy: ObservableObject {
    public enum Status: Equatable, Sendable {
        /// Before `restore` has answered. Rendering this as signed out shows a sign-in screen to
        /// somebody who is signed in, once per launch.
        case loading
        case signedOut
        case signedIn(User)
    }

    @Published public private(set) var status: Status = .loading

    /// The Rust core, for anything this layer does not wrap.
    public nonisolated let core: IdenzyClient
    private let apiURL: URL
    private var settled = false
    private var subscription: Subscription?

    private static var clients: [String: Idenzy] = [:]

    /// The client for a project, created on first use with the Keychain and URLSession.
    ///
    /// - Parameter deviceName: what the user's own device list calls this device. Left unset, the
    ///   row is unnamed; `UIDevice.current.name` is a reasonable value to pass.
    public static func shared(
        publishableKey: String,
        apiURL: URL,
        deviceName: String? = nil
    ) throws -> Idenzy {
        if let existing = clients[publishableKey] {
            guard existing.apiURL == apiURL else {
                throw IdenzyError.Configuration(
                    detail: "\(publishableKey) is already configured against \(existing.apiURL)."
                )
            }
            return existing
        }
        let core = try IdenzyClient(
            config: ClientConfig(
                publishableKey: publishableKey,
                apiUrl: apiURL.absoluteString,
                deviceName: deviceName
            ),
            transport: URLSessionTransport(),
            store: KeychainStore()
        )
        let client = Idenzy(core: core, apiURL: apiURL)
        clients[publishableKey] = client
        return client
    }

    /// For tests and for a host that brings its own transport or store. The one-per-process rule
    /// is then the caller's to keep.
    public init(core: IdenzyClient, apiURL: URL) {
        self.core = core
        self.apiURL = apiURL
        subscription = core.subscribe(listener: StatusRelay(owner: self))
    }

    deinit {
        subscription?.cancel()
    }

    public nonisolated var password: PasswordFlow { core.password() }
    public nonisolated var otp: OtpFlow { core.otp() }
    public nonisolated var magicLink: MagicLinkFlow { core.magicLink() }
    public nonisolated var anonymous: AnonymousFlow { core.anonymous() }
    public nonisolated var account: AccountApi { core.account() }
    public nonisolated var sessions: SessionsApi { core.sessions() }
    public nonisolated var mfa: MfaApi { core.mfa() }
    /// The user's passkeys and the API's half of a ceremony; `addPasskey` and
    /// `signInWithPasskey` run the whole of one.
    public nonisolated var passkeys: PasskeyFlow { core.passkeys() }
    public nonisolated var session: Session? { core.session() }

    /// Picks up the session the last launch left in the Keychain. Call it once, at start-up.
    ///
    /// `status` leaves `loading` once the answer is known. When it cannot be known yet (no
    /// network, a Keychain locked since boot, our API unavailable) the error is thrown, the token
    /// is kept, and `status` stays `loading` for the app to retry when that changes.
    @discardableResult
    public func restore() async throws -> Session? {
        do {
            let session = try await core.restore()
            settle()
            return session
        } catch let error as IdenzyError {
            if !error.leavesSessionUnknown { settle() }
            throw error
        }
    }

    /// A token for the app's own API calls, renewed first if it is close to expiry. `nil` when
    /// nobody is signed in.
    public nonisolated func getToken() async throws -> String? {
        try await core.getToken()
    }

    /// Ends the session on the server and here. Here happens even when the request fails.
    public func signOut(_ scope: SignOutScope = .current) async throws {
        settled = true
        try await core.signOut(scope: scope)
    }

    /// Social sign-in in the system browser (`ASWebAuthenticationSession`), never a web view
    /// (PROJECT.md 4.4).
    ///
    /// - Parameter redirectURI: registered for the project. A custom scheme works everywhere; an
    ///   `https` universal link needs iOS 17.4 or macOS 14.4.
    /// - Parameter ephemeral: no shared cookies with Safari, so the provider asks again.
    public func signInWithOAuth(
        provider: String,
        redirectURI: URL,
        ephemeral: Bool = false
    ) async throws -> AuthResult {
        let flow = core.oauth()
        let start = try await flow.authorizationUrl(provider: provider, redirectUri: redirectURI.absoluteString)
        guard let url = URL(string: start) else {
            throw IdenzyError.Transport(reason: .unexpectedResponse, detail: "Not a URL: \(start)", status: 200)
        }
        let returned = try await SystemBrowser().open(url, returningTo: redirectURI, ephemeral: ephemeral)
        guard let result = try await flow.complete(url: returned.absoluteString) else {
            throw IdenzyError.Transport(
                reason: .unexpectedResponse,
                detail: "The browser returned without a code: \(returned.absoluteString)",
                status: 0
            )
        }
        return result
    }

    /// Sign in with Apple through the system sheet, exchanged for a session (PROJECT.md 4.4).
    ///
    /// The bundle ID must be listed under the project's Apple provider as a native app, and the
    /// app needs the Sign in with Apple capability. Apple shows the app the user's name on the
    /// first sign-in only; it is passed along so a new account is not left nameless.
    public func signInWithApple() async throws -> AuthResult {
        let flow = core.idToken()
        let prepared = try await flow.prepare()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = prepared.digest
        let credential = try await AuthorizationSheet().present(request, expecting: ASAuthorizationAppleIDCredential.self)
        guard let data = credential.identityToken, let token = String(data: data, encoding: .utf8) else {
            throw IdenzyError.Transport(
                reason: .unexpectedResponse,
                detail: "Sign in with Apple returned no identity token.",
                status: 0
            )
        }
        let name = credential.fullName.map {
            PersonNameComponentsFormatter.localizedString(from: $0, style: .default)
        }
        return try await flow.exchange(provider: .apple, idToken: token, nonce: prepared.nonce, displayName: name)
    }

    /// The first half of a native sign-in this SDK does not drive itself, such as Google's own
    /// SDK on iOS: pass `digest` as its nonce, then hand the token to `exchangeIdToken`.
    ///
    /// ```swift
    /// let prepared = try await idenzy.prepareNativeSignIn()
    /// let result = try await GIDSignIn.sharedInstance.signIn(
    ///     withPresenting: controller, hint: nil, additionalScopes: nil, nonce: prepared.digest)
    /// try await idenzy.exchangeIdToken(.google, idToken: result.user.idToken!.tokenString, nonce: prepared.nonce)
    /// ```
    public nonisolated func prepareNativeSignIn() async throws -> IdTokenNonce {
        try await core.idToken().prepare()
    }

    /// Exchanges an ID token from a platform sign-in, with the nonce `prepareNativeSignIn` gave.
    public nonisolated func exchangeIdToken(
        _ provider: NativeProvider,
        idToken: String,
        nonce: String,
        displayName: String? = nil
    ) async throws -> AuthResult {
        try await core.idToken().exchange(provider: provider, idToken: idToken, nonce: nonce, displayName: displayName)
    }

    /// Adds a passkey to the signed-in account through the system's passkey sheet.
    ///
    /// The relying party's domain must list this app under `webcredentials` in its
    /// `apple-app-site-association`, and the app needs the Associated Domains entitlement naming
    /// that domain. Without both the sheet refuses before it is shown.
    public func addPasskey(named name: String? = nil) async throws -> Passkey {
        let flow = core.passkeys()
        let ceremony = try await flow.registrationOptions()
        let options = try PasskeyJSON.creation(ceremony.optionsJson)
        let request = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: options.relyingParty)
            .createCredentialRegistrationRequest(challenge: options.challenge, name: options.userName, userID: options.userID)
        if let preference = options.userVerification {
            request.userVerificationPreference = ASAuthorizationPublicKeyCredentialUserVerificationPreference(rawValue: preference)
        }
        if #available(iOS 17.4, macOS 14.4, *) {
            request.excludedCredentials = options.excluded.map {
                ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0)
            }
        }
        let credential = try await AuthorizationSheet().present(
            request,
            expecting: ASAuthorizationPlatformPublicKeyCredentialRegistration.self
        )
        guard let attestation = credential.rawAttestationObject else {
            throw IdenzyError.Transport(reason: .unexpectedResponse, detail: "The passkey sheet returned no attestation.", status: 0)
        }
        let response = PasskeyJSON.registration(
            credentialID: credential.credentialID,
            clientDataJSON: credential.rawClientDataJSON,
            attestationObject: attestation
        )
        return try await flow.register(challengeId: ceremony.challengeId, responseJson: response, name: name)
    }

    /// Signs in with a passkey through the system's sheet, which offers whichever of the user's
    /// passkeys belong to the relying party. Nothing names the account first.
    public func signInWithPasskey() async throws -> AuthResult {
        let flow = core.passkeys()
        let ceremony = try await flow.authenticationOptions()
        let options = try PasskeyJSON.request(ceremony.optionsJson)
        let request = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: options.relyingParty)
            .createCredentialAssertionRequest(challenge: options.challenge)
        if let preference = options.userVerification {
            request.userVerificationPreference = ASAuthorizationPublicKeyCredentialUserVerificationPreference(rawValue: preference)
        }
        let credential = try await AuthorizationSheet().present(
            request,
            expecting: ASAuthorizationPlatformPublicKeyCredentialAssertion.self
        )
        let response = PasskeyJSON.assertion(
            credentialID: credential.credentialID,
            clientDataJSON: credential.rawClientDataJSON,
            authenticatorData: credential.rawAuthenticatorData,
            signature: credential.signature,
            userHandle: credential.userID
        )
        return try await flow.signIn(challengeId: ceremony.challengeId, responseJson: response)
    }

    /// Finishes a magic link from the URL the app was opened with, or answers `nil` when the URL
    /// is not one of ours. Call it from `onOpenURL` or the scene's universal-link handler.
    public func completeMagicLink(_ url: URL) async throws -> AuthResult? {
        try await core.magicLink().complete(url: url.absoluteString)
    }

    fileprivate func apply(_ state: SessionState) {
        switch (state.status, state.user) {
        case let (.signedIn, user?):
            settled = true
            status = .signedIn(user)
        case (.signedOut, _) where settled:
            status = .signedOut
        default:
            // A signed-out report before restore has answered says "nothing held yet", not
            // "nobody is signed in".
            break
        }
    }

    private func settle() {
        settled = true
        apply(core.state())
    }
}

extension IdenzyError {
    /// The stable code, whichever case carries it. Branch on this, never on a message.
    public var code: ErrorCode { errorCode(error: self) }

    /// Whether the session is still in the store, untested: the request never arrived, or nobody
    /// with authority answered it.
    var leavesSessionUnknown: Bool {
        switch self {
        case .Storage:
            true
        case let .Transport(reason, _, _):
            reason != .interrupted
        case let .Api(_, _, _, status, _, _, _):
            status == 429 || status >= 500
        default:
            false
        }
    }
}

/// Carries core notifications to the main actor in the order they were made. `DispatchQueue.main`
/// rather than a `Task` per change, because tasks are not ordered and a signed-out report could
/// overtake the signed-in one before it.
private final class StatusRelay: SessionListener, @unchecked Sendable {
    private weak var owner: Idenzy?

    init(owner: Idenzy) {
        self.owner = owner
    }

    func onChange(state: SessionState) {
        DispatchQueue.main.async { [weak owner] in
            MainActor.assumeIsolated { owner?.apply(state) }
        }
    }
}
