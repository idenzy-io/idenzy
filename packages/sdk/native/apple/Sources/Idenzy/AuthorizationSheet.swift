import AuthenticationServices
import Foundation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// One run of a system authorization sheet: Sign in with Apple, or a passkey ceremony.
///
/// The sheet is the system's, drawn by it, so this is a platform API call and not authentication
/// UI of ours (ADR-0002).
@MainActor
final class AuthorizationSheet: NSObject {
    private var controller: ASAuthorizationController?
    private var continuation: CheckedContinuation<ASAuthorizationCredential, Error>?

    /// The credential, or the sheet's own `ASAuthorizationError` untranslated: `.canceled` is a
    /// platform contract older than ours, and the screen decides what a cancel means.
    func present(_ request: ASAuthorizationRequest) async throws -> ASAuthorizationCredential {
        defer { controller = nil }
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }

    /// `present`, for a request whose credential has one expected type.
    func present<Credential: ASAuthorizationCredential>(
        _ request: ASAuthorizationRequest,
        expecting _: Credential.Type
    ) async throws -> Credential {
        guard let credential = try await present(request) as? Credential else {
            throw ASAuthorizationError(.invalidResponse)
        }
        return credential
    }

    private func finish(_ result: sending Result<ASAuthorizationCredential, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }
}

extension AuthorizationSheet: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        let credential = authorization.credential
        MainActor.assumeIsolated { finish(.success(credential)) }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated { finish(.failure(error)) }
    }
}

extension AuthorizationSheet: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { SystemBrowser.keyWindow() }
    }
}
