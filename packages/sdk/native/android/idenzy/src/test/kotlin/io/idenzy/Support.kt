package io.idenzy

import io.idenzy.core.ClientConfig
import io.idenzy.core.HttpRequest
import io.idenzy.core.HttpResponse
import io.idenzy.core.HttpTransport
import io.idenzy.core.IdenzyClient
import io.idenzy.core.SecureStore
import io.idenzy.core.TransportFailure
import kotlinx.coroutines.CompletableDeferred
import java.time.Instant
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

internal const val API = "https://auth.example.test/"
internal const val KEY = "pk_test_1"

internal class MemoryStore : SecureStore {
    val values = ConcurrentHashMap<String, String>()
    override fun read(key: String): String? = values[key]
    override fun write(key: String, value: String) { values[key] = value }
    override fun remove(key: String) { values.remove(key) }
    fun named(name: String): String? = values["idenzy.$KEY.$name"]
}

/** Answers routes like `"POST v1/auth/refresh"` from queues; a deferred answer waits for the test. */
internal class QueueTransport : HttpTransport {
    private val queues = ConcurrentHashMap<String, ArrayDeque<CompletableDeferred<HttpResponse>>>()
    val sent = CopyOnWriteArrayList<HttpRequest>()

    fun answer(route: String, status: Int, body: String) {
        later(route).complete(HttpResponse(status.toUShort(), body))
    }

    fun later(route: String): CompletableDeferred<HttpResponse> =
        CompletableDeferred<HttpResponse>().also { synchronized(queues) { queues.getOrPut(route) { ArrayDeque() }.addLast(it) } }

    fun sentTo(route: String): List<HttpRequest> = sent.filter { routeOf(it) == route }

    override suspend fun send(request: HttpRequest): HttpResponse {
        sent.add(request)
        val route = routeOf(request)
        val next = synchronized(queues) { queues[route]?.removeFirstOrNull() }
            ?: throw TransportFailure.NotSent("no answer queued for $route")
        return next.await()
    }

    private fun routeOf(request: HttpRequest) = "${request.method.name} ${request.url.removePrefix(API)}"
}

internal object Fixture {
    fun jwt(lifetimeSeconds: Long): String {
        val now = Instant.now().epochSecond
        val claims = """{"iat":$now,"exp":${now + lifetimeSeconds}}"""
        return "eyJhbGciOiJFUzI1NiJ9.${Base64.getUrlEncoder().withoutPadding().encodeToString(claims.toByteArray())}.c2ln"
    }

    const val USER = """{"id":"usr_00000000000000000001","email":"ada@example.com","emailVerified":true,
        "phone":null,"phoneVerified":false,"displayName":"Ada","avatarUrl":null,"metadataPublic":{},
        "createdAt":"2026-10-11T07:00:00.000Z","lastSignInAt":null}"""

    /** `authOutcomeSchema`, authenticated. A short lifetime makes the next `getToken` rotate. */
    fun authenticated(refreshToken: String = "rt_first_000000000000", lifetimeSeconds: Long = 300) = """
        {"status":"authenticated","user":$USER,"sessionId":"ses_00000000000000000001",
        "accessToken":"${jwt(lifetimeSeconds)}","accessTokenExpiresAt":"${Instant.now().plusSeconds(lifetimeSeconds)}",
        "refreshToken":"$refreshToken"}"""

    /** `sessionRefreshedSchema`. */
    fun refreshed(refreshToken: String) = """
        {"sessionId":"ses_00000000000000000001","accessToken":"${jwt(300)}",
        "accessTokenExpiresAt":"${Instant.now().plusSeconds(300)}","refreshToken":"$refreshToken"}"""
}

internal fun core(transport: HttpTransport, store: SecureStore): IdenzyClient =
    IdenzyClient(ClientConfig(KEY, API, "Ada's Pixel"), transport, store)
