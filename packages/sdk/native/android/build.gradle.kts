buildscript {
    dependencies {
        // Replaces the Kotlin compiler AGP would otherwise bring; see libs.versions.toml.
        classpath(libs.kotlin.gradle.plugin)
    }
}

plugins {
    alias(libs.plugins.android.library) apply false
}
