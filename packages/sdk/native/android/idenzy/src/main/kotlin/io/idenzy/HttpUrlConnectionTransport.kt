package io.idenzy

import android.security.NetworkSecurityPolicy
import io.idenzy.core.HttpRequest
import io.idenzy.core.HttpResponse
import io.idenzy.core.HttpTransport
import io.idenzy.core.TransportFailure
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.URL
import java.net.UnknownHostException
import java.net.UnknownServiceException
import javax.net.ssl.SSLHandshakeException

/**
 * The transport the SDK ships, over the platform's `HttpURLConnection`, so the library adds no
 * HTTP client to an app and a request takes the route the system configures: its proxy, its
 * network security config, and any certificate pinning the app declared there.
 *
 * No redirects and no cache. The API answers JSON only, so a redirect is a misconfiguration to
 * surface rather than follow, and a cached answer to a refresh is a refresh that never happened.
 */
public class HttpUrlConnectionTransport(
    private val connectTimeoutMillis: Int = 15_000,
    private val readTimeoutMillis: Int = 30_000,
    /** The app's network security policy. Replaceable for the JVM tests, where there is none. */
    private val cleartextPermitted: (host: String) -> Boolean = { host ->
        NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(host)
    },
) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = withContext(Dispatchers.IO) {
        val url = try {
            URL(request.url)
        } catch (error: MalformedURLException) {
            throw TransportFailure.NotSent(error.toString())
        }
        // Asked before connecting rather than read off the failure: Android refuses cleartext
        // with a plain IOException, which is indistinguishable from a connection lost mid-request
        // and would read as a refresh token possibly spent. Policy refusal sends nothing.
        if (url.protocol == "http" && !cleartextPermitted(url.host)) {
            throw TransportFailure.NotSent(
                "Cleartext HTTP to ${url.host} is not permitted by this app's network security " +
                    "config. Allow it for development hosts, or use https.",
            )
        }
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = connectTimeoutMillis
            connection.readTimeout = readTimeoutMillis
            connection.requestMethod = request.method.name
            request.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            val body = request.body?.toByteArray(Charsets.UTF_8)
            // Buffered, not streamed. In streaming mode a 401 arrives with no readable body, and
            // the 401 that matters most is a refused refresh: read as an unexpected response
            // rather than a refusal, it would keep a session the server has already ended.
            if (body != null) connection.doOutput = true
            connection.connect()
            body?.let { bytes -> connection.outputStream.use { it.write(bytes) } }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            HttpResponse(status.toUShort(), text)
        } catch (error: IOException) {
            throw failure(error)
        } finally {
            connection.disconnect()
        }
    }

    internal companion object {
        /**
         * `NotSent` only where the exception itself proves no byte of the request reached the
         * server: no name, no route, no connection, a cleartext request OkHttp's policy refused,
         * or a TLS handshake that failed before the request was written. Everything else, a timeout included, may have arrived, and the
         * core must treat a refresh token it carried as possibly spent (ADR-0007).
         */
        fun failure(error: IOException): TransportFailure = when (error) {
            is UnknownHostException,
            is UnknownServiceException,
            is ConnectException,
            is NoRouteToHostException,
            is PortUnreachableException,
            is SSLHandshakeException,
            is MalformedURLException -> TransportFailure.NotSent(error.toString())
            else -> TransportFailure.Interrupted(error.toString())
        }
    }
}
