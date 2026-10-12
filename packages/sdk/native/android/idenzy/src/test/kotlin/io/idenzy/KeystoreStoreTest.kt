package io.idenzy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** The sealing and the recovery rules, with a JCE key standing in for the Keystore's. */
class KeystoreStoreTest {
    private class MapValues : KeystoreStore.Values {
        val map = HashMap<String, String>()
        override fun get(key: String): String? = map[key]
        override fun put(key: String, value: String): Boolean { map[key] = value; return true }
        override fun remove(key: String): Boolean { map.remove(key); return true }
    }

    private fun aesKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private val values = MapValues()
    private val key = aesKey()
    private val store = KeystoreStore(values) { key }

    @Test
    fun roundTripsAndForgets() {
        assertNull(store.read("refresh"))
        store.write("refresh", "rt_1")
        store.write("refresh", "rt_2")
        assertEquals("rt_2", store.read("refresh"))
        store.remove("refresh")
        assertNull(store.read("refresh"))
    }

    @Test
    fun keepsOnlyCiphertextOnDisk() {
        store.write("refresh", "rt_secret_value")
        assertNotEquals("rt_secret_value", values.map["refresh"])
        assert(!values.map.getValue("refresh").contains("rt_secret"))
    }

    @Test
    fun aValueSealedUnderAnotherKeyReadsAsAbsentAndIsRemoved() {
        KeystoreStore(values) { aesKey() }.write("refresh", "rt_from_a_backup")
        assertNull(store.read("refresh"))
        assertNull(values.map["refresh"])
    }

    @Test
    fun aTamperedValueReadsAsAbsentAndIsRemoved() {
        store.write("refresh", "rt_1")
        values.map["refresh"] = values.map.getValue("refresh").reversed()
        assertNull(store.read("refresh"))
        assertNull(values.map["refresh"])
    }
}
