package io.idenzy

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsIntent
import kotlinx.coroutines.CompletableDeferred

/** The browser was closed before the sign-in finished. The screen decides what a cancel means. */
public class OAuthCancelledException : Exception("The browser was closed before the sign-in finished.")

/**
 * Holds an OAuth flow while a Custom Tab is in front, and notices when it comes back without one.
 *
 * A Custom Tab reports nothing when the user closes it, so the only signal is this activity
 * resuming a second time with no redirect delivered. Translucent and never exported: it is
 * scaffolding around the system browser, not a screen (ADR-0002).
 */
internal class OAuthActivity : Activity() {
    private var launched = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        launched = savedInstanceState?.getBoolean(LAUNCHED) ?: false
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        val returned = intent.data
        when {
            returned != null -> deliver(returned.toString())
            !launched -> {
                launched = true
                val url = intent.getStringExtra(URL) ?: return deliver(null)
                CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url))
            }
            else -> deliver(null)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(LAUNCHED, launched)
    }

    private fun deliver(url: String?) {
        val waiting = synchronized(Companion) { pending.also { pending = null } }
        if (waiting != null) {
            waiting.complete(url)
        } else if (url != null) {
            // The process that started the flow is gone. The app's launcher gets the URL and
            // finishes with `Idenzy.completeRedirect`; the PKCE verifier survived in the store.
            packageManager.getLaunchIntentForPackage(packageName)?.let { launcher ->
                startActivity(launcher.setData(Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
        finish()
    }

    companion object {
        private const val URL = "io.idenzy.oauth.url"
        private const val LAUNCHED = "io.idenzy.oauth.launched"
        private var pending: CompletableDeferred<String?>? = null

        /** Opens the URL and answers with the URL the browser returned to. */
        suspend fun open(context: Context, url: String): String {
            val result = CompletableDeferred<String?>()
            synchronized(this) {
                // One flow at a time; a second start abandons the first as cancelled.
                pending?.complete(null)
                pending = result
            }
            val intent = Intent(context, OAuthActivity::class.java).putExtra(URL, url)
            if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            return result.await() ?: throw OAuthCancelledException()
        }
    }
}

/** Receives the redirect on the app's scheme and hands it to [OAuthActivity], then disappears. */
internal class OAuthRedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(
            Intent(this, OAuthActivity::class.java)
                .setData(intent.data)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }
}
