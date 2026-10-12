import Foundation
import XCTest
@testable import Idenzy

final class URLSessionTransportTests: XCTestCase {
    private let transport = URLSessionTransport(configuration: StubProtocol.configuration())

    private func post(_ body: String? = #"{"a":1}"#) -> HttpRequest {
        HttpRequest(
            url: "https://auth.example.test/v1/auth/refresh",
            method: .post,
            headers: ["x-idenzy-publishable-key": "pk_test_1", "content-type": "application/json"],
            body: body
        )
    }

    func testSendsTheMethodHeadersAndBodyAsGiven() async throws {
        StubProtocol.answer = .response(status: 200, headers: [:], body: "{}")
        _ = try await transport.send(request: post())
        let request = try XCTUnwrap(StubProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-idenzy-publishable-key"), "pk_test_1")
        XCTAssertEqual(StubProtocol.lastBody.map { String(decoding: $0, as: UTF8.self) }, #"{"a":1}"#)
    }

    func testAnswersAnErrorStatusRatherThanThrowing() async throws {
        StubProtocol.answer = .response(status: 401, headers: [:], body: #"{"error":{}}"#)
        let response = try await transport.send(request: post())
        XCTAssertEqual(response.status, 401)
        XCTAssertEqual(response.body, #"{"error":{}}"#)
    }

    func testDoesNotFollowARedirect() async throws {
        StubProtocol.answer = .response(status: 302, headers: ["Location": "https://elsewhere.test/"], body: "")
        let response = try await transport.send(request: post())
        XCTAssertEqual(response.status, 302)
    }

    func testCallsAFailureBeforeConnectingNotSent() {
        for code in [URLError.Code.notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .secureConnectionFailed] {
            guard case .NotSent = URLSessionTransport.failure(for: URLError(code)) else {
                return XCTFail("\(code) may have reached the server and was reported as not sent")
            }
        }
    }

    func testCallsEverythingElseInterrupted() {
        for code in [URLError.Code.timedOut, .networkConnectionLost, .cancelled, .badServerResponse] {
            guard case .Interrupted = URLSessionTransport.failure(for: URLError(code)) else {
                return XCTFail("\(code) was reported as never sent, which re-presents a spent token")
            }
        }
    }

    func testMapsAFailedRequestThroughTheSameRule() async {
        StubProtocol.answer = .failure(.timedOut)
        do {
            _ = try await transport.send(request: post())
            XCTFail("expected a failure")
        } catch TransportFailure.Interrupted {
        } catch {
            XCTFail("unexpected \(error)")
        }
    }
}
