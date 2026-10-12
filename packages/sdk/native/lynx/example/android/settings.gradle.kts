pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // io.idenzy:idenzy-lynx and the SDK under it, from `./gradlew publishToMavenLocal` in
        // `packages/sdk/native/android` until they are on Maven Central.
        mavenLocal()
    }
    // The SDK's own catalog, so this app builds with the versions the SDK is built with.
    versionCatalogs {
        create("libs") {
            from(files("../../../android/gradle/libs.versions.toml"))
        }
    }
}

rootProject.name = "idenzy-lynx-example"
include(":app")
