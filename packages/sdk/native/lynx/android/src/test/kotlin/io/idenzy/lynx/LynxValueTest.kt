package io.idenzy.lynx

import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LynxValueTest {
    @Test
    fun aRecordCrossesAsLynxsOwnTypesWithTimestampsAsNumbers() {
        val value = lynxValue(
            mapOf(
                "status" to "authenticated",
                "session" to mapOf("accessTokenExpiresAt" to 1_791_788_700_000L, "user" to mapOf("phone" to null)),
                "factors" to listOf("totp", mapOf("createdAt" to 1L)),
            ),
        ) as JavaOnlyMap

        val session = value["session"] as JavaOnlyMap
        assertEquals(1_791_788_700_000.0, session["accessTokenExpiresAt"])
        assertTrue(session["user"] is JavaOnlyMap)
        assertTrue((session["user"] as JavaOnlyMap).containsKey("phone"))
        val factors = value["factors"] as JavaOnlyArray
        assertEquals("totp", factors[0])
        assertEquals(1.0, (factors[1] as JavaOnlyMap)["createdAt"])
    }
}
