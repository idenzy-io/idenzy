package io.idenzy.lynxexample

import android.app.Activity
import android.os.Bundle
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.provider.AbsTemplateProvider

/** One full-screen LynxView showing `main.lynx.bundle`. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val lynxView = LynxViewBuilder().setTemplateProvider(AssetTemplateProvider()).build(this)
        setContentView(lynxView)
        lynxView.renderTemplateUrl("main.lynx.bundle", "")
    }

    /** Reads a page from the app's assets, off the main thread. */
    private inner class AssetTemplateProvider : AbsTemplateProvider() {
        override fun loadTemplate(uri: String, callback: Callback) {
            Thread {
                try {
                    callback.onSuccess(assets.open(uri).use { it.readBytes() })
                } catch (error: java.io.IOException) {
                    callback.onFailed(error.message)
                }
            }.start()
        }
    }
}
