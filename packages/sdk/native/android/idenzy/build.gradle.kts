plugins {
    alias(libs.plugins.android.library)
    id("maven-publish")
}

android {
    namespace = "io.idenzy"
    compileSdk = 36

    defaultConfig {
        // java.time, which the generated bindings use for every timestamp, without desugaring.
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
        // The scheme the browser returns to after OAuth, e.g. "com.example.app". The app sets it
        // with `manifestPlaceholders["idenzyRedirectScheme"] = ...`; the library cannot guess it.
        manifestPlaceholders["idenzyRedirectScheme"] = "idenzy.unset"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
            // Maven Central refuses a release without one, documentation or not.
            withJavadocJar()
        }
    }

    testOptions {
        unitTests.all { test ->
            // The real core, built for this machine by `scripts/build-android.sh --dev`, so the
            // Kotlin layer is tested against what ships rather than a fake of it.
            test.systemProperty("jna.library.path", layout.buildDirectory.dir("host-native").get().asFile.path)
        }
        // The generated bindings ask `Build.VERSION` which cleaner to use; on the JVM the stub
        // answers 0 and they fall back to JNA's own.
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    jvmToolchain(17)
    // Built by AGP's own Kotlin, written for the oldest an app may use: metadata at 2.1 and a stdlib
    // dependency of 2.1.20. Without this, an app on Kotlin 2.1, which is React Native's, cannot read
    // a single class of this library or of the stdlib it would pull in.
    compilerOptions {
        languageVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_1)
        apiVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_1)
    }
    coreLibrariesVersion = libs.versions.kotlin.floor.get()
}

dependencies {
    implementation("${libs.jna.get()}@aar")
    // An API dependency: `Idenzy.status` is a StateFlow, so an app compiles against it through us.
    api(libs.coroutines.android)
    implementation(libs.androidx.browser)
    // Sign in with Google: Credential Manager and the Google ID token it returns. The same
    // Credential Manager is what passkeys will use.
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.googleid)

    testImplementation(libs.jna)
    testImplementation(libs.junit)
    testImplementation(libs.orgjson)
    testImplementation(libs.coroutines.test)
}

// The coordinates the Flutter plugin and every other bridge depend on. `publishToMavenLocal` serves
// them while developing; Maven Central is the same publication, later.
publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "io.idenzy"
            artifactId = "idenzy-android"
            version = "0.1.0"
            afterEvaluate { from(components["release"]) }
            pom {
                name.set("Idenzy for Android")
                description.set("Sign-in, sessions and MFA for Android, with the session in the Keystore and the refresh rules in a shared Rust core. Headless: every screen is yours.")
            }
        }
    }
}

apply(from = rootProject.file("gradle/publishing.gradle.kts"))
