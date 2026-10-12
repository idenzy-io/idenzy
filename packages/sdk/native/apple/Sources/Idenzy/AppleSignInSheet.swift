import AuthenticationServices
import Foundation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// One run of the system's Sign in with Apple sheet (PROJECT.md 4.4).
///
/// The sheet is Apple's, drawn by the system, so this is a platform API call and not
/// authentication UI of ours (ADR-0002). It asks for the name and the address, which Apple
/// shows the user before it shares either, and signs the nonce digest into the identity token.
@MainActor
final class AppleSignInSheet: NSObject {
    private var controller: ASAuthorizationController?
    private var continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?

    /// The credential, or the sheet's own `ASAuthorizationError` untranslated: `.canceled` is a
    /// platform contract older than ours, and the screen decides what a cancel means.
    func present(nonceDigest: String) async throws -> ASAuthorizationAppleIDCredential {
        defer { controller = nil }
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = nonceDigest
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        self.controller = controller
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            controller.performRequests()
        }
    }

    private func finish(_ result: Result<ASAuthorizationAppleIDCredential, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }
}

extension AppleSignInSheet: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential
        MainActor.assumeIsolated {
            if let credential {
                finish(.success(credential))
            } else {
                finish(.failure(ASAuthorizationError(.invalidResponse)))
            }
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated { finish(.failure(error)) }
    }
}

extension AppleSignInSheet: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated { SystemBrowser.keyWindow() }
    }
}
