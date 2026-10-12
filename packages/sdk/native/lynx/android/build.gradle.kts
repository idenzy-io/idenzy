plugins {
    alias(libs.plugins.android.library)
    id("maven-publish")
}

android {
    namespace = "io.idenzy.lynx"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

kotlin {
    jvmToolchain(17)
    // The same floor as the SDK it carries; see `idenzy/build.gradle.kts`.
    compilerOptions {
        languageVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_1)
        apiVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_1)
    }
    coreLibrariesVersion = libs.versions.kotlin.floor.get()
}

dependencies {
    api(project(":idenzy"))
    compileOnly(libs.lynx)

    testImplementation(libs.lynx)
    testImplementation(libs.junit)
}

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "io.idenzy"
            artifactId = "idenzy-lynx"
            version = "0.1.0"
            afterEvaluate { from(components["release"]) }
        }
    }
}
