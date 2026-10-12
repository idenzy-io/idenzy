package io.idenzy

import android.app.Activity
import android.content.Context
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import io.idenzy.core.AuthResult
import io.idenzy.core.ChallengeStarted
import io.idenzy.core.ClientConfig
import io.idenzy.core.EmailChangeConfirmed
import io.idenzy.core.ErrorCode
import io.idenzy.core.IdenzyClient
import io.idenzy.core.IdTokenNonce
import io.idenzy.core.IdenzyException
import io.idenzy.core.MfaChallenge
import io.idenzy.core.MfaEnrolmentConfirmed
import io.idenzy.core.MfaFactorList
import io.idenzy.core.MfaProof
import io.idenzy.core.NativeProvider
import io.idenzy.core.Passkey
import io.idenzy.core.RecoveryCodes
import io.idenzy.core.Session
import io.idenzy.core.SessionListener
import io.idenzy.core.SessionState
import io.idenzy.core.SessionStatus
import io.idenzy.core.SessionSummary
import io.idenzy.core.SignOutScope
import io.idenzy.core.TotpEnrolment
import io.idenzy.core.TransportReason
import io.idenzy.core.User
import io.idenzy.core.errorCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The client an app holds: every way in, the session as a [StateFlow], and the Custom Tabs half
 * of OAuth. There is no UI in it (ADR-0002); the screens are the app's.
 *
 * One per project per process, which is why it comes from [shared] rather than a constructor. Two
 * clients over one store would rotate the same refresh token independently, and the second
 * rotation revokes the session (ADR-0007).
 *
 * **Every call runs in this client's own scope, never the caller's.** A cancelled coroutine drops
 * whatever it was awaiting, and a refresh dropped in flight is one whose answer was never
 * observed: the core then ends the session rather than risk presenting a spent token. Without
 * this, a user leaving a screen at the wrong moment would be signed out. A caller that is
 * cancelled stops waiting; the call itself finishes. That is also why the core client is not
 * exposed: a call made on it directly would not be shielded.
 */
public class Idenzy internal constructor(private val core: IdenzyClient) {
    public sealed interface Status {
        /** Before [restore] has answered. Rendering it as signed out shows a sign-in screen to
         * somebody who is signed in, once per launch. */
        public data object Loading : Status
        public data object SignedOut : Status
        public data class SignedIn(val user: User) : Status
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val mutableStatus = MutableStateFlow<Status>(Status.Loading)
    public val status: StateFlow<Status> = mutableStatus.asStateFlow()

    @Volatile
    private var settled = false

    init {
        core.subscribe(Relay())
    }

    public val password: Password = Password()
    public val otp: Otp = Otp()
    public val magicLink: MagicLink = MagicLink()
    public val anonymous: Anonymous = Anonymous()
    public val account: Account = Account()
    public val sessions: Sessions = Sessions()
    public val mfa: Mfa = Mfa()
    public val passkeys: Passkeys = Passkeys()

    public val session: Session? get() = core.session()

    /**
     * Picks up the session the last launch stored. Call it once, at start-up.
     *
     * [status] leaves [Status.Loading] once the answer is known. When it cannot be known yet (no
     * network, our API unavailable) the error is thrown, the token is kept, and [status] stays
     * loading for the app to retry when that changes.
     */
    public suspend fun restore(): Session? = try {
        shielded { core.restore() }.also { settle() }
    } catch (error: IdenzyException) {
        if (!error.leavesSessionUnknown) settle()
        throw error
    }

    /** A token for the app's own API calls, renewed first if close to expiry. `null` when signed out. */
    public suspend fun getToken(): String? = shielded { core.getToken() }

    /** Ends the session on the server and here. Here happens even when the request fails. */
    public suspend fun signOut(scope: SignOutScope = SignOutScope.CURRENT) {
        settled = true
        shielded { core.signOut(scope) }
    }

    /**
     * Social sign-in in a Custom Tab, never a web view (PROJECT.md 4.4). The redirect URI's scheme
     * must be the one set as `idenzyRedirectScheme` in the app's manifest placeholders.
     *
     * If Android ends the app's process while the browser is in front, this call is gone with it.
     * The redirect then opens the app's launcher activity with the URL as its data, and
     * [completeRedirect] finishes the sign-in from there; the PKCE verifier is in the store.
     */
    public suspend fun signInWithOAuth(context: Context, provider: String, redirectUri: String): AuthResult {
        val url = shielded { core.oauth().authorizationUrl(provider, redirectUri) }
        val returned = OAuthActivity.open(context, url)
        return completeRedirect(returned)
            ?: throw IdenzyException.Transport(TransportReason.UNEXPECTED_RESPONSE, "The browser returned without a code: $returned", 0u)
    }

    /**
     * Sign in with Google through Credential Manager's own sheet, exchanged for a session
     * (PROJECT.md 4.4).
     *
     * @param serverClientId the project's Google web client ID, the one configured as the
     *   provider's client ID: Credential Manager mints the token for it, whichever app asks.
     *
     * A dismissed sheet arrives as Credential Manager's own `GetCredentialCancellationException`,
     * untranslated, and the screen decides what a cancel means. There is no native sheet for
     * Apple on Android; [signInWithOAuth] with `"apple"` is the way in there.
     */
    public suspend fun signInWithGoogle(activity: Activity, serverClientId: String): AuthResult {
        val prepared = prepareNativeSignIn()
        val option = GetSignInWithGoogleOption.Builder(serverClientId).setNonce(prepared.digest).build()
        val response = CredentialManager.create(activity)
            .getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build())
        val credential = response.credential
        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw IdenzyException.Transport(
                TransportReason.UNEXPECTED_RESPONSE,
                "Credential Manager returned something other than a Google ID token.",
                0u,
            )
        }
        val google = GoogleIdTokenCredential.createFrom(credential.data)
        return exchangeIdToken(NativeProvider.GOOGLE, google.idToken, prepared.nonce, google.displayName)
    }

    /**
     * The first half of a native sign-in this SDK does not drive itself: pass `digest` to the
     * platform's sheet as its nonce, then hand the token to [exchangeIdToken].
     */
    public suspend fun prepareNativeSignIn(): IdTokenNonce = shielded { core.idToken().prepare() }

    /** Exchanges an ID token from a platform sign-in, with the nonce [prepareNativeSignIn] gave. */
    public suspend fun exchangeIdToken(
        provider: NativeProvider,
        idToken: String,
        nonce: String,
        displayName: String? = null,
    ): AuthResult = shielded { core.idToken().exchange(provider, idToken, nonce, displayName) }

    /** Finishes OAuth from the URL the browser returned to, or answers `null` when it is not ours. */
    public suspend fun completeRedirect(url: String): AuthResult? = shielded { core.oauth().complete(url) }

    /** Finishes a magic link from the app link the app was opened with, `null` when not ours. */
    public suspend fun completeMagicLink(url: String): AuthResult? = shielded { core.magicLink().complete(url) }

    private suspend fun <T> shielded(call: suspend () -> T): T = scope.async { call() }.await()

    private fun settle() {
        settled = true
        apply(core.state())
    }

    @Synchronized
    private fun apply(state: SessionState) {
        val user = state.user
        when {
            state.status == SessionStatus.SIGNED_IN && user != null -> {
                settled = true
                mutableStatus.value = Status.SignedIn(user)
            }
            // A signed-out report before restore has answered says "nothing held yet", not
            // "nobody is signed in".
            state.status == SessionStatus.SIGNED_OUT && settled -> mutableStatus.value = Status.SignedOut
        }
    }

    private inner class Relay : SessionListener {
        override fun onChange(state: SessionState): Unit = apply(state)
    }

    public inner class Password internal constructor() {
        public suspend fun signUp(email: String, password: String, displayName: String? = null): AuthResult =
            shielded { core.password().signUp(email, password, displayName) }

        public suspend fun signIn(email: String, password: String): AuthResult =
            shielded { core.password().signIn(email, password) }

        public suspend fun requestReset(email: String): Unit = shielded { core.password().requestReset(email) }

        public suspend fun confirmReset(token: String, password: String): Unit =
            shielded { core.password().confirmReset(token, password) }
    }

    public inner class Otp internal constructor() {
        public suspend fun startEmail(email: String): ChallengeStarted = shielded { core.otp().startEmail(email) }

        public suspend fun startSms(phone: String, attestation: String? = null): ChallengeStarted =
            shielded { core.otp().startSms(phone, attestation) }

        public suspend fun verify(code: String, challengeId: String? = null): AuthResult =
            shielded { core.otp().verify(code, challengeId) }
    }

    public inner class MagicLink internal constructor() {
        public suspend fun start(email: String, redirectUri: String): ChallengeStarted =
            shielded { core.magicLink().start(email, redirectUri) }

        public suspend fun exchange(code: String): AuthResult = shielded { core.magicLink().exchange(code) }
    }

    public inner class Anonymous internal constructor() {
        public suspend fun signIn(): AuthResult = shielded { core.anonymous().signIn() }

        public suspend fun upgrade(email: String, password: String): AuthResult =
            shielded { core.anonymous().upgrade(email, password) }
    }

    public inner class Account internal constructor() {
        public suspend fun me(): User = shielded { core.account().me() }

        public suspend fun requestEmailVerification(): Unit = shielded { core.account().requestEmailVerification() }

        public suspend fun confirmEmailVerification(token: String): Unit =
            shielded { core.account().confirmEmailVerification(token) }

        public suspend fun requestEmailChange(newEmail: String): Unit =
            shielded { core.account().requestEmailChange(newEmail) }

        public suspend fun confirmEmailChange(token: String): EmailChangeConfirmed =
            shielded { core.account().confirmEmailChange(token) }
    }

    public inner class Sessions internal constructor() {
        public suspend fun list(): List<SessionSummary> = shielded { core.sessions().list() }

        public suspend fun revoke(id: String): Unit = shielded { core.sessions().revoke(id) }
    }

    public inner class Mfa internal constructor() {
        public suspend fun factors(): MfaFactorList = shielded { core.mfa().factors() }

        public suspend fun enrollTotp(label: String? = null): TotpEnrolment = shielded { core.mfa().enrollTotp(label) }

        public suspend fun confirmTotp(factorId: String, code: String): MfaEnrolmentConfirmed =
            shielded { core.mfa().confirmTotp(factorId, code) }

        public suspend fun regenerateRecoveryCodes(): RecoveryCodes = shielded { core.mfa().regenerateRecoveryCodes() }

        public suspend fun removeFactor(factorId: String): Unit = shielded { core.mfa().removeFactor(factorId) }

        /** A challenge to raise this session's assurance, or `null` when none is owed. */
        public suspend fun startStepUp(): MfaChallenge? = shielded { core.mfa().startStepUp() }

        /** Answers any challenge, sign-in or step-up. Prefer it to `challenge.submit`, which is not shielded. */
        public suspend fun submit(challenge: MfaChallenge, proof: MfaProof): Session = shielded { challenge.submit(proof) }
    }

    public inner class Passkeys internal constructor() {
        /**
         * Adds a passkey to the signed-in account through Credential Manager.
         *
         * The relying party's domain must list this app, by package and signing certificate, in
         * `/.well-known/assetlinks.json` with `delegate_permission/common.get_login_creds`, and the
         * project must accept the app's `android:apk-key-hash:` origin. Without both, Credential
         * Manager or the API refuses.
         */
        public suspend fun add(activity: Activity, name: String? = null): Passkey {
            val ceremony = shielded { core.passkeys().registrationOptions() }
            val created = CredentialManager.create(activity)
                .createCredential(activity, CreatePublicKeyCredentialRequest(ceremony.optionsJson))
            val response = (created as? CreatePublicKeyCredentialResponse)?.registrationResponseJson
                ?: throw unexpected("Credential Manager created something other than a passkey.")
            return shielded { core.passkeys().register(ceremony.challengeId, response, name) }
        }

        /**
         * Signs in with a passkey through Credential Manager, which offers whichever of the user's
         * passkeys belong to the relying party. Nothing names the account first.
         */
        public suspend fun signIn(activity: Activity): AuthResult {
            val ceremony = shielded { core.passkeys().authenticationOptions() }
            val request = GetCredentialRequest.Builder()
                .addCredentialOption(GetPublicKeyCredentialOption(ceremony.optionsJson))
                .build()
            val credential = CredentialManager.create(activity).getCredential(activity, request).credential
            val response = (credential as? PublicKeyCredential)?.authenticationResponseJson
                ?: throw unexpected("Credential Manager returned something other than a passkey.")
            return shielded { core.passkeys().signIn(ceremony.challengeId, response) }
        }

        public suspend fun list(): List<Passkey> = shielded { core.passkeys().list() }

        public suspend fun remove(id: String): Unit = shielded { core.passkeys().remove(id) }
    }

    private fun unexpected(detail: String): IdenzyException =
        IdenzyException.Transport(TransportReason.UNEXPECTED_RESPONSE, detail, 0u)

    public companion object {
        private val clients = HashMap<String, Pair<String, Idenzy>>()

        /**
         * The client for a project, created on first use over the Keystore and `HttpURLConnection`.
         *
         * @param deviceName what the user's own device list calls this device. Left unset, the row
         *   is unnamed; `Settings.Global.DEVICE_NAME` is a reasonable value to pass.
         */
        @JvmStatic
        public fun shared(context: Context, publishableKey: String, apiUrl: String, deviceName: String? = null): Idenzy =
            synchronized(clients) {
                clients[publishableKey]?.let { (configuredUrl, client) ->
                    if (configuredUrl != apiUrl) {
                        throw IdenzyException.Configuration("$publishableKey is already configured against $configuredUrl.")
                    }
                    return client
                }
                val core = IdenzyClient(
                    ClientConfig(publishableKey, apiUrl, deviceName),
                    HttpUrlConnectionTransport(),
                    KeystoreStore(context.applicationContext),
                )
                Idenzy(core).also { clients[publishableKey] = apiUrl to it }
            }
    }
}

/** The stable code, whichever case carries it. Branch on this, never on a message. */
public val IdenzyException.code: ErrorCode get() = errorCode(this)

/** The session is still in the store, untested: the request never arrived, or nobody with authority answered. */
internal val IdenzyException.leavesSessionUnknown: Boolean
    get() = when (this) {
        is IdenzyException.Storage -> true
        is IdenzyException.Transport -> reason != TransportReason.INTERRUPTED
        is IdenzyException.Api -> status.toInt() == 429 || status.toInt() >= 500
        else -> false
    }
