import ExpoModulesCore
import IdenzyBridge

/// React Native's half on iOS: one Expo function onto `IdenzyBridge`, and one event.
///
/// The method table, the value mapping and the session itself are the Swift SDK's, shared with
/// every other framework (ADR-0022). Failures come back as values, the bridge's `answer`, rather
/// than exceptions: an Expo exception reaches JavaScript as a code and a message, and a screen needs
/// the status, the request id and the field details as well.
public final class IdenzyModule: Module {
    private var statusWatch: UUID?

    public func definition() -> ModuleDefinition {
        Name("Idenzy")

        Events("onStatus")

        AsyncFunction("call") { (method: String, arguments: [String: Any]) async -> [String: Any] in
            await IdenzyBridge.shared.answer(method, arguments)
        }

        OnStartObserving {
            Task { @MainActor in
                self.statusWatch = IdenzyBridge.shared.watchStatus { [weak self] status in
                    self?.sendEvent("onStatus", status)
                }
            }
        }

        OnStopObserving {
            Task { @MainActor in
                if let watch = self.statusWatch { IdenzyBridge.shared.stopWatching(watch) }
                self.statusWatch = nil
            }
        }
    }
}
