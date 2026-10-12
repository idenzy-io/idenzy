group = "io.idenzy.flutter"
version = "0.1.0"

buildscript {
    val kotlinVersion = "2.4.0"
    repositories {
        google()
        mavenCentral()
    }

    dependencies {
        classpath("com.android.tools.build:gradle:9.1.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion")
    }
}

allprojects {
    repositories {
        google()
        // The Android SDK. While it is developed here, the example app adds mavenLocal() for the
        // copy `./gradlew :idenzy:publishToMavenLocal` puts there; a published plugin must not add
        // it to every app that installs it.
        mavenCentral()
    }
}

plugins {
    id("com.android.library")
}

android {
    namespace = "io.idenzy.flutter"
    compileSdk = 36

    sourceSets {
        getByName("main") {
            java.srcDirs("src/main/kotlin")
        }
    }

    defaultConfig {
        // The Android SDK's floor: java.time throughout, without desugaring.
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // Everything about the session lives here; this plugin only carries messages to it.
    implementation("io.idenzy:idenzy-android:0.1.0")
}
