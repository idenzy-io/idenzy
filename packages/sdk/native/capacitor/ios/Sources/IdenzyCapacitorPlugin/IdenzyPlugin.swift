import Capacitor
import Foundation
import IdenzyBridge

/// Capacitor's half on iOS: one method onto the Swift SDK's JSON bridge, and one event.
///
/// JSON both ways, through `IDZBridge`, so the plugin converts nothing: the method table, the value
/// mapping and the session itself are the Swift SDK's (ADR-0022). The session lives here and not in
/// the web view, which is the reason to use this plugin rather than `@idenzy/js` in a Capacitor app.
@objc(IdenzyPlugin)
public class IdenzyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IdenzyPlugin"
    public let jsName = "Idenzy"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "call", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        // Capacitor calls a plugin on its own queue, and the bridge lives on the main thread.
        Task { @MainActor in
            _ = ObjCBridge.shared.watchStatusJSON { [weak self] json in
                self?.notifyListeners("status", data: ["json": json])
            }
        }
    }

    /// Answers with `{ json }`, the bridge's `ok` or `error`, so a refusal is not a rejection.
    @objc func call(_ call: CAPPluginCall) {
        guard let method = call.getString("method"), let arguments = call.getString("arguments") else {
            call.reject("method and arguments are required.")
            return
        }
        Task { @MainActor in
            ObjCBridge.shared.call(method, argumentsJSON: arguments) { call.resolve(["json": $0]) }
        }
    }
}
