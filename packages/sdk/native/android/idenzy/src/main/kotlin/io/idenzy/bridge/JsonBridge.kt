package io.idenzy.bridge

import android.app.Activity
import android.content.Context
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * [IdenzyBridge] in JSON both ways, for NativeScript: it hands Java a JavaScript object as a proxy
 * rather than a map and cannot call a suspending function, while a string crosses as itself and a
 * callback interface is something it implements.
 *
 * Answers on [answerOn], the main thread unless a test says otherwise, because NativeScript runs
 * JavaScript there and a callback into it from another thread fails.
 */
public class JsonBridge internal constructor(
    private val bridge: IdenzyBridge,
    answerOn: CoroutineDispatcher = Dispatchers.Main.immediate,
) {
    /** Receives one JSON document: an answer, or a status. */
    public fun interface Callback {
        public fun onJson(json: String)
    }

    private val scope = CoroutineScope(SupervisorJob() + answerOn)

    /** Calls a method and answers once with the JSON of [IdenzyBridge.answer]. */
    public fun call(method: String, argumentsJson: String, activity: Activity?, done: Callback) {
        val arguments = try {
            mapOf(JSONObject(argumentsJson))
        } catch (_: JSONException) {
            done.onJson(json(mapOf("error" to mapOf("code" to "validation_failed", "message" to "The arguments are not a JSON object.", "details" to emptyMap<String, Any?>()))))
            return
        }
        scope.launch { done.onJson(json(bridge.answer(method, arguments, activity))) }
    }

    /** Reports the session's status as JSON, now and on every change, until closed. */
    public fun watchStatus(report: Callback): AutoCloseable {
        val watch = scope.launch { bridge.statuses.collect { report.onJson(json(it)) } }
        return AutoCloseable { watch.cancel() }
    }

    public companion object {
        private var shared: JsonBridge? = null

        @JvmStatic
        public fun shared(context: Context): JsonBridge = synchronized(this) {
            shared ?: JsonBridge(IdenzyBridge.shared(context)).also { shared = it }
        }
    }
}

private fun mapOf(json: JSONObject): Map<String, Any?> =
    json.keys().asSequence().associateWith { valueOf(json.get(it)) }

private fun valueOf(value: Any?): Any? = when (value) {
    JSONObject.NULL, null -> null
    is JSONObject -> mapOf(value)
    is JSONArray -> (0 until value.length()).map { valueOf(value.get(it)) }
    else -> value
}

/**
 * Written by hand rather than through `org.json`: Android's `JSONObject(Map)` keeps a null value
 * and the reference library the unit tests run on drops it, so a test of it would not test what
 * ships. And a null here is an answer: no phone number, no session.
 */
internal fun json(value: Any?): String = when (value) {
    null -> "null"
    is String -> quoted(value)
    is Boolean, is Int, is Long, is Short, is Byte -> value.toString()
    is Double -> if (value.isFinite()) value.toString() else "null"
    is Float -> if (value.isFinite()) value.toString() else "null"
    is Map<*, *> -> value.entries.joinToString(",", "{", "}") { (key, item) -> quoted(key.toString()) + ":" + json(item) }
    is Iterable<*> -> value.joinToString(",", "[", "]") { json(it) }
    is Array<*> -> value.joinToString(",", "[", "]") { json(it) }
    else -> quoted(value.toString())
}

private fun quoted(text: String): String = buildString(text.length + 2) {
    append('"')
    for (char in text) {
        when {
            char == '"' -> append("\\\"")
            char == '\\' -> append("\\\\")
            char == '\n' -> append("\\n")
            char == '\r' -> append("\\r")
            char == '\t' -> append("\\t")
            char < ' ' -> append("\\u%04x".format(char.code))
            else -> append(char)
        }
    }
    append('"')
}
