import Foundation

/// `IdenzyBridge` for Objective-C callers: Lynx's native module, which has to be Objective-C
/// because Lynx defines no Clang module for Swift to import, and NativeScript, which reaches native
/// code through the Objective-C runtime and sees nothing Swift does not export.
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
}
