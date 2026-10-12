package io.idenzy

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import io.idenzy.core.SecureStore
import io.idenzy.core.StoreFailure
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Values encrypted under an AES-256-GCM key that lives in the Android Keystore and never leaves it
 * (PROJECT.md 4.4), with the ciphertext in the app's private preferences.
 *
 * A value restored onto another device by Auto Backup arrives without the key that sealed it,
 * because Keystore keys are never backed up. It can never be opened, so it reads as absent and is
 * removed, which signs the user in again rather than restoring a session onto a phone it was not
 * issued to.
 */
public class KeystoreStore internal constructor(
    private val values: Values,
    private val key: () -> SecretKey,
) : SecureStore {
    public constructor(context: Context) : this(
        PreferencesValues(context.getSharedPreferences(FILE, Context.MODE_PRIVATE)),
        { keystoreKey(ALIAS) },
    )

    @Synchronized
    override fun read(key: String): String? {
        val sealed = values.get(key) ?: return null
        return try {
            open(sealed)
        } catch (error: GeneralSecurityException) {
            if (!error.isPermanent()) throw unavailable(error)
            values.remove(key)
            null
        } catch (error: IllegalArgumentException) {
            values.remove(key)
            null
        }
    }

    @Synchronized
    override fun write(key: String, value: String) {
        val sealed = try {
            seal(value)
        } catch (error: GeneralSecurityException) {
            throw unavailable(error)
        }
        if (!values.put(key, sealed)) throw StoreFailure.Unavailable("The preferences file refused the write.")
    }

    @Synchronized
    override fun remove(key: String) {
        if (!values.remove(key)) throw StoreFailure.Unavailable("The preferences file refused the removal.")
    }

    private fun seal(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.getEncoder().encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)))
    }

    private fun open(sealed: String): String {
        val bytes = Base64.getDecoder().decode(sealed)
        require(bytes.size > IV_BYTES) { "too short to be sealed" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
        return cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES).toString(Charsets.UTF_8)
    }

    /** The key is gone or is not the one that sealed this value, and no retry changes that. */
    private fun GeneralSecurityException.isPermanent(): Boolean =
        this is AEADBadTagException || this is KeyPermanentlyInvalidatedException || this is UnrecoverableKeyException

    private fun unavailable(error: Exception) = StoreFailure.Unavailable("Keystore: $error")

    /** Where the ciphertext lives. An interface so the tests can run without a device. */
    internal interface Values {
        fun get(key: String): String?
        fun put(key: String, value: String): Boolean
        fun remove(key: String): Boolean
    }

    /**
     * `commit`, never `apply`: the core stores a rotated refresh token before it does anything
     * else, and `apply` would report success before the token was on disk.
     */
    private class PreferencesValues(private val preferences: SharedPreferences) : Values {
        override fun get(key: String): String? = preferences.getString(key, null)
        override fun put(key: String, value: String): Boolean = preferences.edit().putString(key, value).commit()
        override fun remove(key: String): Boolean = preferences.edit().remove(key).commit()
    }

    internal companion object {
        const val FILE = "io.idenzy.store"
        const val ALIAS = "io.idenzy.store"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128

        fun keystoreKey(alias: String): SecretKey {
            val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (keystore.getKey(alias, null) as? SecretKey)?.let { return it }
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            return generator.generateKey()
        }
    }
}
