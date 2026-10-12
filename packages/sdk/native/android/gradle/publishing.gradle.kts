// What Maven Central asks of every artifact this build publishes, applied by each module that
// publishes one: the POM it requires, a signature on every file when a key is present, and a
// local repository laid out the way the Central Portal takes a bundle (docs/guide/native.md).
//
// Signing only happens with SIGNING_KEY in the environment, so `publishToMavenLocal` while
// developing stays unsigned and needs no key. The release workflow sets it, signs, publishes to
// build/central, zips that and uploads it.

configure<PublishingExtension> {
    publications.withType<MavenPublication>().configureEach {
        pom {
            url.set("https://github.com/idenzy-io/idenzy")
            licenses {
                license {
                    name.set("MIT")
                    url.set("https://opensource.org/license/mit")
                }
            }
            developers {
                developer {
                    id.set("idenzy")
                    name.set("Idenzy")
                    organizationUrl.set("https://idenzy.io")
                }
            }
            scm {
                url.set("https://github.com/idenzy-io/idenzy")
                connection.set("scm:git:https://github.com/idenzy-io/idenzy.git")
                developerConnection.set("scm:git:ssh://git@github.com/idenzy-io/idenzy.git")
            }
        }
    }
    repositories {
        maven {
            name = "central"
            url = uri(rootProject.layout.buildDirectory.dir("central"))
        }
    }
}

val signingKey = providers.environmentVariable("SIGNING_KEY").orNull
if (signingKey != null) {
    apply(plugin = "signing")
    configure<SigningExtension> {
        useInMemoryPgpKeys(signingKey, providers.environmentVariable("SIGNING_PASSWORD").orNull)
        sign(extensions.getByType<PublishingExtension>().publications)
    }
}
