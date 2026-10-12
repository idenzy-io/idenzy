import Foundation
@testable import Idenzy

/// A store with no persistence, for tests that are not about the Keychain.
final class MemoryStore: SecureStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: String] = [:]

    func read(key: String) throws -> String? { lock.withLock { values[key] } }
    func write(key: String, value: String) throws { lock.withLock { values[key] = value } }
    func remove(key: String) throws { _ = lock.withLock { values.removeValue(forKey: key) } }

    func value(_ name: String) -> String? { lock.withLock { values.first { $0.key.hasSuffix(".\(name)") }?.value } }
}

/// Answers `"POST v1/auth/sign-in/password"` and the like from a table, recording what it was sent.
final class TableTransport: HttpTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var replies: [String: (UInt16, String)]
    private(set) var sent: [HttpRequest] = []

    init(_ replies: [String: (UInt16, String)]) {
        self.replies = replies
    }

    func send(request: HttpRequest) async throws -> HttpResponse {
        let path = request.url.replacingOccurrences(of: "https://auth.example.test/", with: "")
        let route = "\(request.method == .get ? "GET" : "POST") \(path)"
        let reply = lock.withLock {
            sent.append(request)
            return replies[route]
        }
        guard let (status, body) = reply else {
            throw TransportFailure.NotSent(detail: "no reply for \(route)")
        }
        return HttpResponse(status: status, body: body)
    }
}

/// Serves canned answers to a URLSession, and records the request it was asked.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    enum Answer {
        case response(status: Int, headers: [String: String], body: String)
        case failure(URLError.Code)
    }

    nonisolated(unsafe) static var answer: Answer = .response(status: 200, headers: [:], body: "")
    nonisolated(unsafe) static var lastRequest: URLRequest?
    nonisolated(unsafe) static var lastBody: Data?

    static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return configuration
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        Self.lastBody = request.httpBody ?? request.httpBodyStream.map(Self.drain)
        switch Self.answer {
        case let .response(status, headers, body):
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
            if (300..<400).contains(status), let location = headers["Location"], let target = URL(string: location) {
                client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: target), redirectResponse: response)
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        case let .failure(code):
            client?.urlProtocol(self, didFailWithError: URLError(code))
        }
    }

    override func stopLoading() {}

    private static func drain(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

/// Wire fixtures, written to the zod schemas they name in `@idenzy/protocol`.
enum Fixture {
    static let user = """
    {"id":"usr_00000000000000000001","email":"ada@example.com","emailVerified":true,"phone":null,
    "phoneVerified":false,"displayName":"Ada","avatarUrl":null,"metadataPublic":{},
    "createdAt":"2026-10-11T07:00:00.000Z","lastSignInAt":null}
    """

    /// `authOutcomeSchema`, authenticated, with a token whose claims say it lives five minutes.
    static func authenticated(refreshToken: String = "rt_first_000000000000") -> String {
        let now = Int(Date().timeIntervalSince1970)
        let claims = Data(#"{"iat":\#(now),"exp":\#(now + 300)}"#.utf8).base64EncodedString()
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
        let expires = ISO8601DateFormatter().string(from: Date().addingTimeInterval(300))
        return """
        {"status":"authenticated","user":\(user),"sessionId":"ses_00000000000000000001",
        "accessToken":"eyJhbGciOiJFUzI1NiJ9.\(claims).c2ln","accessTokenExpiresAt":"\(expires)",
        "refreshToken":"\(refreshToken)"}
        """
    }
}
