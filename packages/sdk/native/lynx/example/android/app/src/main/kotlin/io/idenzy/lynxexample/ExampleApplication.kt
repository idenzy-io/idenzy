package io.idenzy.lynxexample

import android.app.Application
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.service.LynxServiceCenter
import io.idenzy.lynx.IdenzyLynxModule

class ExampleApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // The log service carries the page's console to logcat, where the self-test is read.
        LynxServiceCenter.inst().registerService(LynxLogService)
        LynxEnv.inst().init(this, null, null, null)
        // Before the first LynxView: a page sees the modules registered when it was built.
        LynxEnv.inst().registerModule("Idenzy", IdenzyLynxModule::class.java)
    }
}
