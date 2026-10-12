plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "io.idenzy.lynxexample"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.idenzy.lynxexample"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        manifestPlaceholders["idenzyRedirectScheme"] = "io.idenzy.lynxexample"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // The page `npm run build` writes, served from the app's assets as `main.lynx.bundle`.
    sourceSets["main"].assets.directories.add("../../dist")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.lynx)
    implementation(libs.lynx.jssdk)
    implementation(libs.lynx.trace)
    implementation(libs.lynx.service.log)
    implementation(libs.primjs)
    implementation("io.idenzy:idenzy-lynx:0.1.0")
}
