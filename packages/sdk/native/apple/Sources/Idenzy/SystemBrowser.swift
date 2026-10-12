import AuthenticationServices
import Foundation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// One trip through `ASWebAuthenticationSession`: out to the provider, back on the redirect URI.
///
/// The system's browser sheet and not a page of ours: it shows the provider's real URL and the
/// user's own saved credentials, which is the whole case for it over an embedded web view.
@MainActor
final class SystemBrowser: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    /// The URL the browser returned to. A user who closes the sheet arrives as
    /// `ASWebAuthenticationSessionError.canceledLogin`, untranslated: that is a platform contract
    /// older than ours, and the screen decides what a cancel means.
    func open(_ url: URL, returningTo redirect: URL, ephemeral: Bool) async throws -> URL {
        defer { session = nil }
        return try await withCheckedThrowingContinuation { continuation in
            let completion: ASWebAuthenticationSession.CompletionHandler = { returned, error in
                if let returned {
                    continuation.resume(returning: returned)
                } else {
                    continuation.resume(throwing: error ?? ASWebAuthenticationSessionError(.canceledLogin))
                }
            }
            let session = Self.session(for: url, returningTo: redirect, completion: completion)
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = ephemeral
            self.session = session
            if !session.start() {
                continuation.resume(throwing: ASWebAuthenticationSessionError(.presentationContextInvalid))
            }
        }
    }

    private static func session(
        for url: URL,
        returningTo redirect: URL,
        completion: @escaping ASWebAuthenticationSession.CompletionHandler
    ) -> ASWebAuthenticationSession {
        if #available(iOS 17.4, macOS 14.4, *), redirect.scheme?.lowercased() == "https", let host = redirect.host {
            return ASWebAuthenticationSession(
                url: url,
                callback: .https(host: host, path: redirect.path),
                completionHandler: completion
            )
        }
        return ASWebAuthenticationSession(url: url, callbackURLScheme: redirect.scheme, completionHandler: completion)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        Self.keyWindow()
    }

    /// The window a system sheet presents over: the key window of the foreground scene.
    static func keyWindow() -> ASPresentationAnchor {
        #if canImport(UIKit)
        let windows = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
        return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
        #else
        return NSApplication.shared.keyWindow ?? ASPresentationAnchor()
        #endif
    }
}
