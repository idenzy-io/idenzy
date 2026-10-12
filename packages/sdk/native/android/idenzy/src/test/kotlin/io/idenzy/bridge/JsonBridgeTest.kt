package io.idenzy.bridge

import io.idenzy.Fixture
import io.idenzy.Idenzy
import io.idenzy.KEY
import io.idenzy.MemoryStore
import io.idenzy.QueueTransport
import io.idenzy.core
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The bridge as NativeScript reaches it: JSON in, JSON out, through a callback. */
class JsonBridgeTest {
    private val transport = QueueTransport()
    private val bridge = JsonBridge(
        IdenzyBridge(android.content.ContextWrapper(null), Idenzy(core(transport, MemoryStore())), KEY),
        Dispatchers.Unconfined,
    )

    private fun call(method: String, argumentsJson: String): String = runBlocking {
        val answer = CompletableDeferred<String>()
        bridge.call(method, argumentsJson, null) { answer.complete(it) }
        answer.await()
    }

    @Test
    fun anAnswerIsJsonWithTimestampsAsNumbersAndNullsKept() {
        transport.answer("POST v1/auth/sign-in/password", 200, Fixture.authenticated())

        val answer = JSONObject(call("password.signIn", """{"email":"ada@example.com","password":"pw"}"""))

        val user = answer.getJSONObject("ok").getJSONObject("session").getJSONObject("user")
        assertEquals(1_791_702_000_000L, user.getLong("createdAt"))
        assertTrue(user.has("phone") && user.isNull("phone"))
    }

    @Test
    fun argumentsThatAreNotAnObjectAreRefusedBeforeAnythingIsSent() {
        val answer = JSONObject(call("password.signIn", "[1, 2]"))

        assertEquals("validation_failed", answer.getJSONObject("error").getString("code"))
        assertTrue(transport.sent.isEmpty())
    }

    @Test
    fun aStringIsEscapedAndANumberIsLeftAlone() {
        assertEquals("""{"a":"say \"hi\"\n","b":[1,2.5,true,null]}""", json(mapOf("a" to "say \"hi\"\n", "b" to listOf(1, 2.5, true, null))))
    }
}
