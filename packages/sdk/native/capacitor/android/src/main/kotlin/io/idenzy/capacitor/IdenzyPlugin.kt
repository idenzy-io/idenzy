package io.idenzy.capacitor

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import io.idenzy.bridge.JsonBridge

/**
 * Capacitor's half on Android: one method onto the Android SDK's JSON bridge, and one event.
 *
 * JSON both ways, so the plugin converts nothing: the method table, the value mapping and the
 * session itself are the Android SDK's (ADR-0022). The session lives here and not in the web view,
 * which is the reason to use this plugin rather than `@idenzy/js` in a Capacitor app.
 */
@CapacitorPlugin(name = "Idenzy")
public class IdenzyPlugin : Plugin() {
    private var statuses: AutoCloseable? = null

    private val bridge: JsonBridge
        get() = JsonBridge.shared(context)

    override fun load() {
        statuses = bridge.watchStatus { json -> notifyListeners("status", JSObject().put("json", json)) }
    }

    /** Answers with `{ json }`, the bridge's `ok` or `error`, so a refusal is not a rejection. */
    @PluginMethod
    public fun call(call: PluginCall) {
        val method = call.getString("method")
        val arguments = call.getString("arguments")
        if (method == null || arguments == null) {
            call.reject("method and arguments are required.")
            return
        }
        bridge.call(method, arguments, activity) { json -> call.resolve(JSObject().put("json", json)) }
    }

    override fun handleOnDestroy() {
        statuses?.close()
    }
}
