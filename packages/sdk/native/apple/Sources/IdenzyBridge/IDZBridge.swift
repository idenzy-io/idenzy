import Foundation

/// `IdenzyBridge` for Objective-C callers: Lynx's native module, which has to be Objective-C
/// because Lynx defines no Clang module for Swift to import, and NativeScript, which reaches native
/// code through the Objective-C runtime and sees nothing Swift does not export. NativeScript takes
/// the JSON variants.
///
/// Main thread only, like the bridge itself; a caller on another thread hops first. A call's
/// completion runs once, on the main thread, with the same `ok` or `error` value as `answer`.
@objc(IDZBridge)
@MainActor
public final class ObjCBridge: NSObject {
    @objc public static let shared = ObjCBridge(bridge: .shared)

    private let bridge: IdenzyBridge

    init(bridge: IdenzyBridge) {
        self.bridge = bridge
    }

    @objc(callMethod:arguments:completion:)
    public func call(_ method: String, arguments: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        Task { completion(await bridge.answer(method, arguments)) }
    }

    /// Reports the session's status now and on every change, until the returned token is passed
    /// to `stopWatching`.
    @objc(watchStatus:)
    public func watchStatus(_ report: @escaping ([String: Any]) -> Void) -> String {
        bridge.watchStatus(report).uuidString
    }

    @objc(stopWatching:)
    public func stopWatching(_ token: String) {
        if let watch = UUID(uuidString: token) { bridge.stopWatching(watch) }
    }

    /// `call` in JSON both ways, for NativeScript: it hands Objective-C a JavaScript object as a
    /// proxy rather than a dictionary, and reads a dictionary back the same way, while a string
    /// crosses as itself.
    @objc(callMethod:argumentsJSON:completion:)
    public func call(_ method: String, argumentsJSON: String, completion: @escaping (String) -> Void) {
        let object = argumentsJSON.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) }
        guard let arguments = object as? [String: Any] else {
            completion(Self.json(Self.refusal("validation_failed", "The arguments are not a JSON object.")))
            return
        }
        call(method, arguments: arguments) { completion(Self.json($0)) }
    }

    /// `watchStatus` in JSON, for NativeScript.
    @objc(watchStatusJSON:)
    public func watchStatusJSON(_ report: @escaping (String) -> Void) -> String {
        watchStatus { report(Self.json($0)) }
    }

    /// Every value the bridge answers with is JSON already, strings, numbers, booleans, null and
    /// collections of them, but `JSONSerialization` raises an exception Swift cannot catch on
    /// anything else, so it is asked first.
    static func json(_ value: [String: Any]) -> String {
        guard
            JSONSerialization.isValidJSONObject(value),
            let data = try? JSONSerialization.data(withJSONObject: value),
            let text = String(data: data, encoding: .utf8)
        else { return json(refusal("internal_error", "The answer could not be written as JSON.")) }
        return text
    }

    private static func refusal(_ code: String, _ message: String) -> [String: Any] {
        ["error": ["code": code, "message": message, "details": [String: Any]()]]
    }
}
