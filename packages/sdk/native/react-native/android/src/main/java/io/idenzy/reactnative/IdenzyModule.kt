package io.idenzy.reactnative

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import io.idenzy.bridge.IdenzyBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * React Native's half on Android: one Expo function onto [IdenzyBridge], and one event.
 *
 * The method table, the value mapping and the session itself are the Android SDK's, shared with
 * every other framework (ADR-0022). Failures come back as values, the bridge's `answer`, rather
 * than exceptions: an Expo exception reaches JavaScript as a code and a message, and a screen
 * needs the status, the request id and the field details as well.
 */
public class IdenzyModule : Module() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var statuses: Job? = null

    private val bridge: IdenzyBridge
        get() = IdenzyBridge.shared(appContext.reactContext ?: throw Exceptions.ReactContextLost())

    override fun definition() = ModuleDefinition {
        Name("Idenzy")

        Events("onStatus")

        AsyncFunction("call") Coroutine { method: String, arguments: Map<String, Any?> ->
            bridge.answer(method, arguments, appContext.currentActivity)
        }

        OnStartObserving {
            statuses?.cancel()
            statuses = scope.launch { bridge.statuses.collect { sendEvent("onStatus", it) } }
        }

        OnStopObserving {
            statuses?.cancel()
        }

        OnDestroy {
            scope.cancel()
        }
    }
}
