package io.idenzy.lynx

import com.lynx.jsbridge.LynxContextModule
import com.lynx.jsbridge.LynxMethod
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.react.bridge.ReadableMap
import com.lynx.tasm.behavior.LynxContext
import io.idenzy.bridge.IdenzyBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Lynx's half on Android: `NativeModules.Idenzy`, one method onto [IdenzyBridge] and one global
 * event.
 *
 * The method table, the value mapping and the session itself are the Android SDK's, shared with
 * every other framework (ADR-0022). Register it once, before the first `LynxView`:
 * `LynxEnv.inst().registerModule("Idenzy", IdenzyLynxModule::class.java)`.
 */
public class IdenzyLynxModule(context: LynxContext) : LynxContextModule(context) {
    // Lynx calls a module on its JavaScript thread. Everything here hops to the main one, so the
    // watch below is only ever touched there.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var statuses: Job? = null

    private val bridge: IdenzyBridge
        get() = IdenzyBridge.shared(mLynxContext.context)

    /** Answers with `ok` or `error`, a value either way, so [done] is called exactly once. */
    @LynxMethod
    public fun call(method: String, arguments: ReadableMap, done: Callback) {
        val values = arguments.toHashMap()
        scope.launch {
            done.invoke(lynxValue(bridge.answer(method, values, mLynxContext.activity)))
        }
    }

    /** Sends the status as `idenzy:status`, now and on every change. Harmless twice. */
    @LynxMethod
    public fun watchStatus() {
        scope.launch {
            if (statuses != null) return@launch
            statuses = launch {
                bridge.statuses.collect { mLynxContext.sendGlobalEvent(STATUS_EVENT, JavaOnlyArray.of(lynxValue(it))) }
            }
        }
    }

    override fun destroy() {
        scope.cancel()
        super.destroy()
    }

    private companion object {
        const val STATUS_EVENT = "idenzy:status"
    }
}

/**
 * A bridge value as Lynx carries it to JavaScript: its own map and array types, all the way down,
 * and every `Long` as a `Double`. Lynx maps a JavaScript number to `double` and a `long` to a
 * BigInt, and a millisecond timestamp is a number on the other side.
 */
internal fun lynxValue(value: Any?): Any? = when (value) {
    is Map<*, *> -> JavaOnlyMap().also { map -> value.forEach { (key, item) -> map[key.toString()] = lynxValue(item) } }
    is List<*> -> JavaOnlyArray().also { array -> value.forEach { array.add(lynxValue(it)) } }
    is Long -> value.toDouble()
    else -> value
}
