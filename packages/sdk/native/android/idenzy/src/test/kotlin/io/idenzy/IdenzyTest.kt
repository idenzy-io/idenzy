package io.idenzy

import io.idenzy.core.AuthResult
import io.idenzy.core.IdenzyException
import io.idenzy.core.SessionStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class IdenzyTest {
    private val transport = QueueTransport()
    private val store = MemoryStore()

    private suspend fun waitFor(condition: () -> Boolean) = withTimeout(5_000) {
        while (!condition()) delay(5)
    }

    @Test
    fun staysLoadingUntilRestoreAnswers() = runBlocking {
        val idenzy = Idenzy(core(transport, store))
        assertEquals(Idenzy.Status.Loading, idenzy.status.value)
        idenzy.restore()
        assertEquals(Idenzy.Status.SignedOut, idenzy.status.value)
        assertTrue(transport.sent.isEmpty())
    }

    @Test
    fun signingInReachesTheStatusAndTheStore() = runBlocking {
        val idenzy = Idenzy(core(transport, store))
        transport.answer("POST v1/auth/sign-in/password", 200, Fixture.authenticated())

        val result = idenzy.password.signIn("ada@example.com", "pw")

        val session = (result as AuthResult.Authenticated).session
        assertEquals(Idenzy.Status.SignedIn(session.user), idenzy.status.first { it is Idenzy.Status.SignedIn })
        assertEquals("rt_first_000000000000", store.named("refresh"))
        assertEquals("Ada's%20Pixel", transport.sent.single().headers["x-idenzy-device-name"])
    }

    @Test
    fun aCallerCancelledMidRefreshDoesNotCostTheSession() = runBlocking {
        val idenzy = Idenzy(core(transport, store))
        transport.answer("POST v1/auth/sign-in/password", 200, Fixture.authenticated(lifetimeSeconds = 10))
        idenzy.password.signIn("ada@example.com", "pw")
        val gate = transport.later("POST v1/auth/refresh")

        val caller = launch { idenzy.getToken() }
        waitFor { transport.sentTo("POST v1/auth/refresh").isNotEmpty() }
        caller.cancel()
        gate.complete(io.idenzy.core.HttpResponse(200u, Fixture.refreshed("rt_second_00000000000")))

        waitFor { store.named("refresh") == "rt_second_00000000000" }
        assertNotNull(idenzy.getToken())
        assertEquals(1, transport.sentTo("POST v1/auth/refresh").size)
        assertTrue(idenzy.status.value is Idenzy.Status.SignedIn)
    }

    /** The control for the test above: unshielded, the same cancellation ends the session. */
    @Test
    fun theSameCancellationAgainstTheCoreDirectlyEndsTheSession() = runBlocking {
        val core = core(transport, store)
        transport.answer("POST v1/auth/sign-in/password", 200, Fixture.authenticated(lifetimeSeconds = 10))
        core.password().signIn("ada@example.com", "pw")
        val gate = transport.later("POST v1/auth/refresh")

        val caller = launch { core.getToken() }
        waitFor { transport.sentTo("POST v1/auth/refresh").isNotEmpty() }
        caller.cancel()
        caller.join()
        gate.complete(io.idenzy.core.HttpResponse(200u, Fixture.refreshed("rt_second_00000000000")))

        try {
            core.getToken()
            fail("an abandoned rotation was followed by another")
        } catch (expected: IdenzyException.Transport) {
        }
        assertEquals(SessionStatus.SIGNED_OUT, core.state().status)
        assertNull(store.named("refresh"))
    }

    @Test
    fun restoringOfflineKeepsTheTokenAndStaysLoading() = runBlocking {
        store.values["idenzy.$KEY.refresh"] = "rt_first_000000000000"
        val idenzy = Idenzy(core(transport, store))
        try {
            idenzy.restore()
            fail("expected the transport failure")
        } catch (error: IdenzyException) {
            assertEquals(io.idenzy.core.ErrorCode.PROVIDER_UNAVAILABLE, error.code)
        }
        assertEquals(Idenzy.Status.Loading, idenzy.status.value)
        assertEquals("rt_first_000000000000", store.named("refresh"))
    }

    @Test
    fun aNativeSignInHandsTheSheetADigestAndTheApiTheNonce() = runBlocking {
        val idenzy = Idenzy(core(transport, store))
        val expires = java.time.Instant.now().plusSeconds(600)
        transport.answer("POST v1/auth/id-token/nonce", 200, """{"nonce":"server-nonce","expiresAt":"$expires"}""")
        transport.answer("POST v1/auth/id-token", 200, Fixture.authenticated())

        val prepared = idenzy.prepareNativeSignIn()
        val expected = java.security.MessageDigest.getInstance("SHA-256")
            .digest("server-nonce".toByteArray())
            .joinToString("") { "%02x".format(it) }
        assertEquals(expected, prepared.digest)

        val result = idenzy.exchangeIdToken(io.idenzy.core.NativeProvider.GOOGLE, "google.id.token", prepared.nonce, "Ada")
        assertTrue(result is AuthResult.Authenticated)
        val body = transport.sentTo("POST v1/auth/id-token").single().body!!
        assertTrue(body.contains("\"provider\":\"google\""))
        assertTrue(body.contains("\"nonce\":\"server-nonce\""))
        assertTrue("the digest belongs to the sheet, never to the API", !body.contains(prepared.digest))
    }
}
