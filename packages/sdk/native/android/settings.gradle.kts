pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // One place declares where dependencies come from, so a module cannot quietly add a repository.
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "idenzy-android"
include(":idenzy")

// Lynx's native module. Its sources live with the rest of `@idenzy/lynx`; it is built here so it
// compiles against this SDK as it is and is emitted for the same Kotlin floor.
include(":idenzy-lynx")
project(":idenzy-lynx").projectDir = file("../lynx/android")
