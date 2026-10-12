package io.idenzy.flutter

import android.app.Activity
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.idenzy.bridge.BridgeFailure
import io.idenzy.bridge.IdenzyBridge
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The Flutter plugin's Android half: a method channel onto [IdenzyBridge], and nothing else.
 *
 * The method table, the value mapping and the session itself are the Android SDK's, shared with
 * every other framework's plugin (ADR-0022). This class only carries messages.
 */
public class IdenzyPlugin : FlutterPlugin, MethodChannel.MethodCallHandler, EventChannel.StreamHandler, ActivityAware {
    private lateinit var methods: MethodChannel
    private lateinit var events: EventChannel
    private lateinit var bridge: IdenzyBridge
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var activity: Activity? = null
    private var statuses: Job? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        bridge = IdenzyBridge.shared(binding.applicationContext)
        methods = MethodChannel(binding.binaryMessenger, "io.idenzy/sdk").also { it.setMethodCallHandler(this) }
        events = EventChannel(binding.binaryMessenger, "io.idenzy/status").also { it.setStreamHandler(this) }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        methods.setMethodCallHandler(null)
        events.setStreamHandler(null)
        scope.cancel()
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        @Suppress("UNCHECKED_CAST") // The Dart side sends a map of string keys or nothing.
        val arguments = call.arguments as? Map<String, Any?> ?: emptyMap()
        scope.launch {
            try {
                result.success(bridge.call(call.method, arguments, activity))
            } catch (failure: BridgeFailure) {
                result.error(failure.code, failure.message, failure.details)
            }
        }
    }

    override fun onListen(arguments: Any?, sink: EventChannel.EventSink) {
        statuses?.cancel()
        statuses = scope.launch { bridge.statuses.collect { sink.success(it) } }
    }

    override fun onCancel(arguments: Any?) {
        statuses?.cancel()
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivity() {
        activity = null
    }
}
