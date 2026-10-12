package io.idenzy.bridge

import io.idenzy.Fixture
import io.idenzy.Idenzy
import io.idenzy.KEY
import io.idenzy.MemoryStore
import io.idenzy.QueueTransport
import io.idenzy.core
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The method table every framework plugin sits on: names in, plain values out. */
class IdenzyBridgeTest {
    private val transport = QueueTransport()
    private val bridge = IdenzyBridge(android.content.ContextWrapper(null), Idenzy(core(transport, MemoryStore())), KEY)

    @Test
    fun aSignInAnswersWithPlainValuesAFrameworkCanCarry() = runBlocking {
        transport.answer("POST v1/auth/sign-in/password", 200, Fixture.authenticated())

        @Suppress("UNCHECKED_CAST")
        val result = bridge.call("password.signIn", mapOf("email" to "ada@example.com", "password" to "pw")) as Map<String, Any?>

        assertEquals("authenticated", result["status"])
        @Suppress("UNCHECKED_CAST")
        val user = (result["session"] as Map<String, Any?>)["user"] as Map<String, Any?>
        assertEquals("ada@example.com", user["email"])
        assertEquals(1_791_702_000_000L, user["createdAt"])
    }

    @Test
    fun aRefusalCrossesAsTheApisOwnCode() = runBlocking {
        transport.answer(
            "POST v1/auth/sign-in/password",
            401,
            """{"error":{"code":"invalid_credentials","message":"No.","requestId":"req_1"}}""",
        )
        try {
            bridge.call("password.signIn", mapOf("email" to "ada@example.com", "password" to "wrong"))
            fail("expected a refusal")
        } catch (failure: BridgeFailure) {
            assertEquals("invalid_credentials", failure.code)
            assertEquals(401, failure.details["status"])
            assertEquals("req_1", failure.details["requestId"])
        }
    }

    @Test
    fun aMissingArgumentIsRefusedBeforeAnythingIsSent() = runBlocking {
        try {
            bridge.call("password.signIn", mapOf("email" to "ada@example.com"))
            fail("expected a refusal")
        } catch (failure: BridgeFailure) {
            assertEquals("validation_failed", failure.code)
        }
        assertTrue(transport.sent.isEmpty())
    }

    @Test
    fun aSecondProjectIsRefusedRatherThanTakingOverTheFirst() = runBlocking {
        try {
            bridge.call("configure", mapOf("publishableKey" to "pk_test_2", "apiUrl" to "https://auth.example.test"))
            fail("expected a refusal")
        } catch (failure: BridgeFailure) {
            assertEquals("validation_failed", failure.code)
            assertTrue(failure.message.contains(KEY))
        }
        assertTrue(transport.sent.isEmpty())
    }

    @Test
    fun anAnswerCarriesAFailureAsAValueWithItsDetails() = runBlocking {
        val answer = bridge.answer("password.signIn", mapOf("email" to "ada@example.com"))

        @Suppress("UNCHECKED_CAST")
        val error = answer["error"] as Map<String, Any?>
        assertEquals("validation_failed", error["code"])
        assertTrue(error["details"] is Map<*, *>)
        assertTrue("ok" !in answer)
    }

    @Test
    fun anUnknownMethodIsUnsupportedRatherThanIgnored() = runBlocking {
        try {
            bridge.call("password.teleport")
            fail("expected a refusal")
        } catch (failure: BridgeFailure) {
            assertEquals("unsupported_platform", failure.code)
        }
    }
}
