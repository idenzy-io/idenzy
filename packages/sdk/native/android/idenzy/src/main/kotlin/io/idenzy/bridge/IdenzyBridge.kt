package io.idenzy.bridge

import android.app.Activity
import android.content.Context
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import io.idenzy.Idenzy
import io.idenzy.OAuthCancelledException
import io.idenzy.core.AuthResult
import io.idenzy.core.ChallengeStarted
import io.idenzy.core.FieldError
import io.idenzy.core.IdTokenNonce
import io.idenzy.core.IdenzyException
import io.idenzy.core.MfaChallenge
import io.idenzy.core.MfaEnrolmentConfirmed
import io.idenzy.core.MfaFactorSummary
import io.idenzy.core.MfaProof
import io.idenzy.core.NativeProvider
import io.idenzy.core.Passkey
import io.idenzy.core.RecoveryCodes
import io.idenzy.core.Session
import io.idenzy.core.SessionSummary
import io.idenzy.core.SignOutScope
import io.idenzy.core.TransportReason
import io.idenzy.core.User
import io.idenzy.core.errorRawCode
import io.idenzy.core.wireAuthMethod
import io.idenzy.core.wireMfaChallengePurpose
import io.idenzy.core.wireMfaFactorType
import io.idenzy.core.wireSessionRevokeReason
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/**
 * A failure as every cross-platform framework receives it: a stable code, a message, and the
 * details a screen may branch on. `code` is the API's own (`invalid_credentials`), `cancelled` for
 * a sheet or browser the user closed, or `unsupported_platform`.
 */
public class BridgeFailure(
    public val code: String,
    override val message: String,
    public val details: Map<String, Any?>,
) : Exception(message)

/**
 * The Kotlin SDK as one method table over plain values, for Flutter, React Native, Lynx,
 * NativeScript and Capacitor alike (ADR-0022).
 *
 * Every framework moves maps of strings, numbers and booleans across its own channel, so the
 * table of method names and the mapping of every record to such a map are written once, here,
 * and each framework's adapter only carries messages. Timestamps cross as milliseconds since the
 * epoch, enums as their wire values. Nothing here decides anything about a session: that is
 * [Idenzy]'s, including running every call in its own scope, and this class only names its
 * methods.
 */
public class IdenzyBridge private constructor(private val context: Context) {
    private val client = MutableStateFlow<Idenzy?>(null)

    /** The project [client] belongs to. A bridge serves one project for the life of the process. */
    private var publishableKey: String? = null

    /** Challenges handed out by id, so `mfa.submit` reaches the object that can answer it. */
    private val challenges = ConcurrentHashMap<String, MfaChallenge>()

    internal constructor(context: Context, configured: Idenzy, publishableKey: String) : this(context) {
        client.value = configured
        this.publishableKey = publishableKey
    }

    /**
     * Calls a method by name and answers with a plain value, or throws [BridgeFailure].
     *
     * @param activity the activity in front, for the calls that show a system sheet or browser.
     */
    public suspend fun call(method: String, arguments: Map<String, Any?> = emptyMap(), activity: Activity? = null): Any? =
        try {
            answer(method, Arguments(arguments), activity)
        } catch (failure: BridgeFailure) {
            throw failure
        } catch (error: IdenzyException) {
            throw BridgeFailure(errorRawCode(error), error.detailText(), error.details())
        } catch (error: OAuthCancelledException) {
            throw BridgeFailure("cancelled", error.message ?: "cancelled", emptyMap())
        } catch (error: GetCredentialCancellationException) {
            throw BridgeFailure("cancelled", error.message ?: "cancelled", emptyMap())
        } catch (error: CreateCredentialCancellationException) {
            throw BridgeFailure("cancelled", error.message ?: "cancelled", emptyMap())
        } catch (error: GetCredentialException) {
            // No passkey for the relying party, an app the domain does not list: the platform's to
            // explain, and its type and message are the explanation.
            throw BridgeFailure("internal_error", "${error.type}: ${error.message}", emptyMap())
        } catch (error: CreateCredentialException) {
            throw BridgeFailure("internal_error", "${error.type}: ${error.message}", emptyMap())
        }

    /**
     * Calls a method by name and answers with `{ ok }` or `{ error: { code, message, details } }`,
     * never throwing a [BridgeFailure]. The shape every JavaScript carrier hands to
     * `@idenzy/native-js`, written once here rather than in each of them.
     */
    public suspend fun answer(method: String, arguments: Map<String, Any?> = emptyMap(), activity: Activity? = null): Map<String, Any?> =
        try {
            mapOf("ok" to call(method, arguments, activity))
        } catch (failure: BridgeFailure) {
            mapOf("error" to mapOf("code" to failure.code, "message" to failure.message, "details" to failure.details))
        }

    /** The session's status, now and on every change, once `configure` has been called. */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    public val statuses: Flow<Map<String, Any?>> = client.filterNotNull().flatMapLatest { configured ->
        configured.status.map(::status)
    }

    private suspend fun answer(method: String, arguments: Arguments, activity: Activity?): Any? {
        if (method == "configure") {
            val key = arguments.text("publishableKey")
            synchronized(this) {
                // Every handle a framework holds reaches this one client, and every status watch
                // follows it, so a second project would take them all over without saying so.
                // Configuring the same one again, as a hot reload does, is harmless.
                publishableKey?.let { configured ->
                    if (configured != key) {
                        throw IdenzyException.Configuration("This app is already configured for $configured; restart it to use $key.")
                    }
                }
                client.value = Idenzy.shared(context, key, arguments.text("apiUrl"), arguments.optional("deviceName"))
                publishableKey = key
            }
            return null
        }
        val idenzy = client.value ?: throw IdenzyException.Configuration("Configure Idenzy first.")
        fun foreground(): Activity =
            activity ?: throw IdenzyException.Configuration("This call needs an activity in the foreground.")
        return when (method) {
            "restore" -> idenzy.restore()?.let(::session)
            "getToken" -> idenzy.getToken()
            "session" -> idenzy.session?.let(::session)
            "signOut" -> idenzy.signOut(if (arguments.optional("scope") == "all") SignOutScope.ALL else SignOutScope.CURRENT)
            "password.signIn" -> authResult(idenzy.password.signIn(arguments.text("email"), arguments.text("password")))
            "password.signUp" -> authResult(
                idenzy.password.signUp(arguments.text("email"), arguments.text("password"), arguments.optional("displayName")),
            )
            "password.requestReset" -> idenzy.password.requestReset(arguments.text("email"))
            "password.confirmReset" -> idenzy.password.confirmReset(arguments.text("token"), arguments.text("password"))
            "otp.startEmail" -> started(idenzy.otp.startEmail(arguments.text("email")))
            "otp.startSms" -> started(idenzy.otp.startSms(arguments.text("phone"), arguments.optional("attestation")))
            "otp.verify" -> authResult(idenzy.otp.verify(arguments.text("code"), arguments.optional("challengeId")))
            "magicLink.start" -> started(idenzy.magicLink.start(arguments.text("email"), arguments.text("redirectUri")))
            "magicLink.complete" -> idenzy.completeMagicLink(arguments.text("url"))?.let(::authResult)
            "oauth.signIn" -> authResult(idenzy.signInWithOAuth(foreground(), arguments.text("provider"), arguments.text("redirectUri")))
            "oauth.complete" -> idenzy.completeRedirect(arguments.text("url"))?.let(::authResult)
            "apple.signIn" -> throw BridgeFailure(
                "unsupported_platform",
                "There is no Sign in with Apple sheet on Android. Use OAuth with provider 'apple'.",
                emptyMap(),
            )
            "google.signIn" -> authResult(idenzy.signInWithGoogle(foreground(), arguments.text("serverClientId")))
            "idToken.prepare" -> nonce(idenzy.prepareNativeSignIn())
            "idToken.exchange" -> authResult(
                idenzy.exchangeIdToken(
                    if (arguments.text("provider") == "apple") NativeProvider.APPLE else NativeProvider.GOOGLE,
                    arguments.text("idToken"),
                    arguments.text("nonce"),
                    arguments.optional("displayName"),
                ),
            )
            "passkey.add" -> passkey(idenzy.passkeys.add(foreground(), arguments.optional("name")))
            "passkey.signIn" -> authResult(idenzy.passkeys.signIn(foreground()))
            "passkey.list" -> idenzy.passkeys.list().map(::passkey)
            "passkey.remove" -> idenzy.passkeys.remove(arguments.text("id"))
            "anonymous.signIn" -> authResult(idenzy.anonymous.signIn())
            "anonymous.upgrade" -> authResult(idenzy.anonymous.upgrade(arguments.text("email"), arguments.text("password")))
            "account.me" -> user(idenzy.account.me())
            "account.requestEmailVerification" -> idenzy.account.requestEmailVerification()
            "account.confirmEmailVerification" -> idenzy.account.confirmEmailVerification(arguments.text("token"))
            "account.requestEmailChange" -> idenzy.account.requestEmailChange(arguments.text("newEmail"))
            "account.confirmEmailChange" -> mapOf("applied" to idenzy.account.confirmEmailChange(arguments.text("token")).applied)
            "sessions.list" -> idenzy.sessions.list().map(::sessionSummary)
            "sessions.revoke" -> idenzy.sessions.revoke(arguments.text("id"))
            "mfa.factors" -> idenzy.mfa.factors().let { list ->
                mapOf("factors" to list.factors.map(::factor), "recoveryCodesRemaining" to list.recoveryCodesRemaining.toInt())
            }
            "mfa.enrollTotp" -> idenzy.mfa.enrollTotp(arguments.optional("label")).let {
                mapOf("factorId" to it.factorId, "secret" to it.secret, "uri" to it.uri)
            }
            "mfa.confirmTotp" -> enrolment(idenzy.mfa.confirmTotp(arguments.text("factorId"), arguments.text("code")))
            "mfa.regenerateRecoveryCodes" -> recoveryCodes(idenzy.mfa.regenerateRecoveryCodes())
            "mfa.removeFactor" -> idenzy.mfa.removeFactor(arguments.text("factorId"))
            "mfa.startStepUp" -> idenzy.mfa.startStepUp()?.let(::challenge)
            "mfa.submit" -> {
                val held = challenges[arguments.text("challengeId")]
                    ?: throw IdenzyException.InvalidInput("That challenge is not one this app started, or it is finished.", emptyList())
                val code = arguments.text("code")
                val proof = if (arguments.text("factor") == "recovery") MfaProof.RecoveryCode(code) else MfaProof.Totp(code)
                session(idenzy.mfa.submit(held, proof)).also { challenges.remove(held.challengeId()) }
            }
            else -> throw BridgeFailure("unsupported_platform", "Unknown method $method.", emptyMap())
        }
    }

    private fun authResult(result: AuthResult): Map<String, Any?> = when (result) {
        is AuthResult.Authenticated -> mapOf("status" to "authenticated", "session" to session(result.session))
        is AuthResult.MfaRequired -> mapOf("status" to "mfa_required", "challenge" to challenge(result.challenge))
    }

    private fun challenge(held: MfaChallenge): Map<String, Any?> {
        challenges[held.challengeId()] = held
        return mapOf(
            "challengeId" to held.challengeId(),
            "purpose" to wireMfaChallengePurpose(held.purpose()),
            "factors" to held.factors().map { wireMfaFactorType(it) },
            "expiresAt" to millis(held.expiresAt()),
        )
    }

    private fun status(status: Idenzy.Status): Map<String, Any?> = when (status) {
        is Idenzy.Status.Loading -> mapOf("status" to "loading")
        is Idenzy.Status.SignedOut -> mapOf("status" to "signedOut")
        is Idenzy.Status.SignedIn -> mapOf("status" to "signedIn", "user" to user(status.user))
    }

    private fun session(session: Session): Map<String, Any?> = mapOf(
        "id" to session.id,
        "user" to user(session.user),
        "accessToken" to session.accessToken,
        "accessTokenExpiresAt" to millis(session.accessTokenExpiresAt),
    )

    private fun user(user: User): Map<String, Any?> = mapOf(
        "id" to user.id,
        "email" to user.email,
        "emailVerified" to user.emailVerified,
        "phone" to user.phone,
        "phoneVerified" to user.phoneVerified,
        "displayName" to user.displayName,
        "avatarUrl" to user.avatarUrl,
        "metadataPublicJson" to user.metadataPublicJson,
        "createdAt" to millis(user.createdAt),
        "lastSignInAt" to user.lastSignInAt?.let(::millis),
    )

    private fun started(started: ChallengeStarted) =
        mapOf("challengeId" to started.challengeId, "expiresAt" to millis(started.expiresAt))

    private fun nonce(nonce: IdTokenNonce) =
        mapOf("nonce" to nonce.nonce, "digest" to nonce.digest, "expiresAt" to millis(nonce.expiresAt))

    private fun factor(factor: MfaFactorSummary) = mapOf(
        "id" to factor.id,
        "type" to wireMfaFactorType(factor.factorType),
        "label" to factor.label,
        "createdAt" to millis(factor.createdAt),
        "lastUsedAt" to factor.lastUsedAt?.let(::millis),
    )

    private fun passkey(passkey: Passkey) = mapOf(
        "id" to passkey.id,
        "name" to passkey.name,
        "transports" to passkey.transports,
        "backupEligible" to passkey.backupEligible,
        "backedUp" to passkey.backedUp,
        "createdAt" to millis(passkey.createdAt),
        "lastUsedAt" to passkey.lastUsedAt?.let(::millis),
    )

    private fun recoveryCodes(codes: RecoveryCodes) =
        mapOf("codes" to codes.codes, "generatedAt" to millis(codes.generatedAt))

    private fun enrolment(confirmed: MfaEnrolmentConfirmed) =
        mapOf("factor" to factor(confirmed.factor), "recoveryCodes" to confirmed.recoveryCodes?.let(::recoveryCodes))

    private fun sessionSummary(row: SessionSummary) = mapOf(
        "id" to row.id,
        "deviceName" to row.deviceName,
        "ip" to row.ip,
        "userAgent" to row.userAgent,
        "amr" to row.amr.map { wireAuthMethod(it) },
        "createdAt" to millis(row.createdAt),
        "lastActiveAt" to millis(row.lastActiveAt),
        "absoluteExpiresAt" to millis(row.absoluteExpiresAt),
        "revokedAt" to row.revokedAt?.let(::millis),
        "revokeReason" to row.revokeReason?.let { wireSessionRevokeReason(it) },
        "current" to row.current,
    )

    private fun millis(instant: Instant): Long = instant.toEpochMilli()

    public companion object {
        private var shared: IdenzyBridge? = null

        /** One bridge per process, over the one client per project [Idenzy.shared] keeps. */
        @JvmStatic
        public fun shared(context: Context): IdenzyBridge = synchronized(this) {
            shared ?: IdenzyBridge(context.applicationContext).also { shared = it }
        }
    }
}

/** The call's arguments, read with the refusal a missing one deserves. */
private class Arguments(private val values: Map<String, Any?>) {
    fun text(name: String): String = values[name] as? String
        ?: throw IdenzyException.InvalidInput("$name is required.", listOf(FieldError(name, "missing")))

    fun optional(name: String): String? = values[name] as? String
}

private fun IdenzyException.detailText(): String = when (this) {
    is IdenzyException.Api -> detail
    is IdenzyException.Transport -> detail
    is IdenzyException.MissingCredentials -> detail
    is IdenzyException.InvalidInput -> detail
    is IdenzyException.Configuration -> detail
    is IdenzyException.Redirect -> detail
    is IdenzyException.Storage -> detail
}

private fun IdenzyException.details(): Map<String, Any?> = when (this) {
    is IdenzyException.Api -> mapOf(
        "status" to status.toInt(),
        "requestId" to requestId,
        "retryAfterSeconds" to retryAfterSeconds?.toInt(),
        "fields" to fields.map { mapOf("path" to it.path, "code" to it.code) },
    )
    is IdenzyException.Transport -> mapOf(
        "status" to status.toInt(),
        "transportReason" to when (reason) {
            TransportReason.NOT_SENT -> "notSent"
            TransportReason.INTERRUPTED -> "interrupted"
            TransportReason.UNEXPECTED_RESPONSE -> "unexpectedResponse"
        },
    )
    is IdenzyException.InvalidInput -> mapOf("fields" to fields.map { mapOf("path" to it.path, "code" to it.code) })
    else -> emptyMap()
}
