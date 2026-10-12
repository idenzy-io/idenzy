package io.idenzy

import com.sun.net.httpserver.HttpServer
import io.idenzy.core.HttpMethod
import io.idenzy.core.HttpRequest
import io.idenzy.core.TransportFailure
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

class HttpUrlConnectionTransportTest {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply { start() }
    private val base = "http://127.0.0.1:${server.address.port}"
    private val transport = HttpUrlConnectionTransport(cleartextPermitted = { true })

    @Volatile private var received: Triple<String, Map<String, String>, String>? = null

    private fun answer(status: Int, body: String, headers: Map<String, String> = emptyMap()) {
        server.createContext("/") { exchange ->
            received = Triple(
                exchange.requestMethod,
                exchange.requestHeaders.mapValues { it.value.first() }.mapKeys { it.key.lowercase() },
                exchange.requestBody.readBytes().toString(Charsets.UTF_8),
            )
            headers.forEach { (name, value) -> exchange.responseHeaders.add(name, value) }
            val bytes = body.toByteArray()
            exchange.sendResponseHeaders(status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
    }

    @After
    fun stop() = server.stop(0)

    private fun post(url: String = "$base/v1/auth/refresh") = HttpRequest(
        url,
        HttpMethod.POST,
        mapOf("x-idenzy-publishable-key" to "pk_test_1", "content-type" to "application/json"),
        """{"a":1}""",
    )

    @Test
    fun sendsTheMethodHeadersAndBodyAsGiven() = runBlocking {
        answer(200, "{}")
        transport.send(post())
        val (method, headers, body) = received!!
        assertEquals("POST", method)
        assertEquals("pk_test_1", headers["x-idenzy-publishable-key"])
        assertEquals("""{"a":1}""", body)
    }

    @Test
    fun answersAnErrorStatusRatherThanThrowing() = runBlocking {
        answer(401, """{"error":{}}""")
        val response = transport.send(post())
        assertEquals(401, response.status.toInt())
        assertEquals("""{"error":{}}""", response.body)
    }

    @Test
    fun doesNotFollowARedirect() = runBlocking {
        answer(302, "", mapOf("Location" to "https://elsewhere.test/"))
        assertEquals(302, transport.send(post()).status.toInt())
    }

    @Test
    fun aRefusedConnectionWasNeverSent() = runBlocking {
        val closed = ServerSocket(0).use { it.localPort }
        try {
            transport.send(post("http://127.0.0.1:$closed/v1/auth/refresh"))
            fail("expected a failure")
        } catch (failure: TransportFailure.NotSent) {
        }
    }

    @Test
    fun cleartextThePolicyRefusesWasNeverSent() = runBlocking {
        answer(200, "{}")
        val strict = HttpUrlConnectionTransport(cleartextPermitted = { false })
        try {
            strict.send(post())
            fail("expected a failure")
        } catch (failure: TransportFailure.NotSent) {
            assertTrue(failure.detail.contains("network security config"))
        }
        assertEquals(null, received)
    }

    @Test
    fun onlyFailuresBeforeTheRequestCountAsNotSent() {
        assertTrue(HttpUrlConnectionTransport.failure(UnknownHostException()) is TransportFailure.NotSent)
        assertTrue(HttpUrlConnectionTransport.failure(SSLHandshakeException("x")) is TransportFailure.NotSent)
        assertTrue(HttpUrlConnectionTransport.failure(java.net.UnknownServiceException("CLEARTEXT")) is TransportFailure.NotSent)
        assertTrue(HttpUrlConnectionTransport.failure(SocketTimeoutException()) is TransportFailure.Interrupted)
        assertTrue(HttpUrlConnectionTransport.failure(java.io.IOException("reset")) is TransportFailure.Interrupted)
    }
}
