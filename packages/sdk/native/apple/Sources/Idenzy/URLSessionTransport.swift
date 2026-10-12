import Foundation
import IdenzyCore

/// The transport the SDK ships, over URLSession, so a request takes the route the system already
/// configures: the user's proxy, App Transport Security, and whatever a developer is inspecting.
///
/// Ephemeral, with no cookie storage, no cache and no redirects. The API answers JSON only, so a
/// redirect is a misconfiguration to surface rather than follow; a cookie jar would carry a
/// session header mode never asked for; and a cached answer to a refresh is a refresh that never
/// happened.
public final class URLSessionTransport: HttpTransport, @unchecked Sendable {
    private let session: URLSession

    public init(configuration: URLSessionConfiguration = .ephemeral) {
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration, delegate: RefuseRedirects(), delegateQueue: nil)
    }

    public func send(request: HttpRequest) async throws -> HttpResponse {
        guard let url = URL(string: request.url) else {
            throw TransportFailure.NotSent(detail: "Not a URL: \(request.url)")
        }
        var outgoing = URLRequest(url: url)
        outgoing.httpMethod = request.method.verb
        for (name, value) in request.headers {
            outgoing.setValue(value, forHTTPHeaderField: name)
        }
        outgoing.httpBody = request.body.map { Data($0.utf8) }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: outgoing)
        } catch let error as URLError {
            throw Self.failure(for: error)
        } catch {
            throw TransportFailure.Interrupted(detail: String(describing: error))
        }
        guard let http = response as? HTTPURLResponse else {
            throw TransportFailure.Interrupted(detail: "The answer was not HTTP.")
        }
        return HttpResponse(
            status: UInt16(clamping: http.statusCode),
            body: String(decoding: data, as: UTF8.self)
        )
    }

    /// `NotSent` only where URLSession can prove no byte of the request reached the server: no
    /// network, no name, no connection, or a TLS handshake that failed before the request was
    /// written. Everything else, a timeout included, may have arrived, and the core must treat a
    /// refresh token it carried as possibly spent (ADR-0007).
    static func failure(for error: URLError) -> TransportFailure {
        switch error.code {
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff, .callIsActive,
             .cannotFindHost, .dnsLookupFailed, .cannotConnectToHost,
             .secureConnectionFailed, .serverCertificateHasBadDate, .serverCertificateUntrusted,
             .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid,
             .clientCertificateRejected, .clientCertificateRequired,
             .appTransportSecurityRequiresSecureConnection, .badURL, .unsupportedURL:
            return .NotSent(detail: error.localizedDescription)
        default:
            return .Interrupted(detail: error.localizedDescription)
        }
    }
}

private extension HttpMethod {
    var verb: String {
        switch self {
        case .get: "GET"
        case .post: "POST"
        case .delete: "DELETE"
        }
    }
}

/// Answers a redirect with the 3xx itself, which the core reports as a response it did not expect.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
