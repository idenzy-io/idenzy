buildscript {
    dependencies {
        // The same Kotlin compiler as the SDK; see its libs.versions.toml.
        classpath(libs.kotlin.gradle.plugin)
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
}
