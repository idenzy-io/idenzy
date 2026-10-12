allprojects {
    repositories {
        google()
        mavenCentral()
        // The Idenzy Android SDK, until it is published: built and published locally by
        // packages/sdk/native/scripts/build-android.sh and `./gradlew :idenzy:publishToMavenLocal`.
        mavenLocal()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
