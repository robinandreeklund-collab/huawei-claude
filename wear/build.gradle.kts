// Root build file. Plugin versions are declared here and applied per-module.
// AGP 9 ships built-in Kotlin (bundles KGP 2.2.10), so the standalone
// kotlin.android plugin is gone. We bump the built-in Kotlin to the latest
// stable (2.4.0) via the buildscript classpath; the Compose compiler plugin
// below must match that version.
buildscript {
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.0")
    }
}
plugins {
    id("com.android.application") version "9.2.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.0" apply false
}
