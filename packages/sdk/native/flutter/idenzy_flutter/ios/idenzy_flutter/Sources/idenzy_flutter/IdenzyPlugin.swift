import Flutter
import IdenzyBridge
import UIKit

/// The Flutter plugin's iOS half: a method channel onto `IdenzyBridge`, and nothing else.
///
/// The method table, the value mapping and the session itself are the Swift SDK's, shared with
/// every other framework's plugin (ADR-0022). This class only carries messages.
public final class IdenzyPlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
    private var statusWatch: UUID?

    public static func register(with registrar: FlutterPluginRegistrar) {
        let plugin = IdenzyPlugin()
        let methods = FlutterMethodChannel(name: "io.idenzy/sdk", binaryMessenger: registrar.messenger())
        registrar.addMethodCallDelegate(plugin, channel: methods)
        FlutterEventChannel(name: "io.idenzy/status", binaryMessenger: registrar.messenger())
            .setStreamHandler(plugin)
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        let arguments = call.arguments as? [String: Any] ?? [:]
        Task { @MainActor in
            do {
                result(try await IdenzyBridge.shared.call(call.method, arguments))
            } catch let failure as BridgeFailure {
                result(FlutterError(code: failure.code, message: failure.message, details: failure.details))
            } catch {
                result(FlutterError(code: "internal_error", message: String(describing: error), details: nil))
            }
        }
    }

    public func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        MainActor.assumeIsolated {
            statusWatch = IdenzyBridge.shared.watchStatus { events($0) }
        }
        return nil
    }

    public func onCancel(withArguments arguments: Any?) -> FlutterError? {
        MainActor.assumeIsolated {
            if let statusWatch { IdenzyBridge.shared.stopWatching(statusWatch) }
            statusWatch = nil
        }
        return nil
    }
}
