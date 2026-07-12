plugins {
    id("com.android.application")
    // Kotlin support is built into AGP 9 — no kotlin.android plugin needed.
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.claude.watch"
    compileSdk = 37        // required by androidx.core 1.19 / lifecycle 2.11

    defaultConfig {
        applicationId = "com.claude.watch"
        minSdk = 30            // Wear OS 3 (Galaxy Watch 4 and later)
        targetSdk = 37         // latest platform (satisfies Play's rolling target-API rule)
        versionCode = 1
        versionName = "1.0"

        // The public URL of YOUR relay backend (Render). The watch connects here
        // directly over WSS. Override per-build with -PbaseUrl=... or edit it in
        // the app's pairing screen (⚙ Server), which persists an override.
        val baseUrl = (project.findProperty("baseUrl") as String?)
            ?: "https://huawei-claude-backend.onrender.com"
        buildConfigField("String", "DEFAULT_BASE_URL", "\"$baseUrl\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// Configure the Kotlin toolchain via the modern compilerOptions DSL (works with
// AGP 9's built-in Kotlin). AGP 9 defaults Java to 11; we pin 17 to match above.
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    val composeUi = "1.11.4"
    val wearCompose = "1.6.2"

    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")

    // Compose runtime/ui (non-wear parts)
    implementation("androidx.compose.ui:ui:$composeUi")
    implementation("androidx.compose.ui:ui-graphics:$composeUi")
    implementation("androidx.compose.ui:ui-tooling-preview:$composeUi")
    debugImplementation("androidx.compose.ui:ui-tooling:$composeUi")

    // Compose for Wear OS
    implementation("androidx.wear.compose:compose-material:$wearCompose")
    implementation("androidx.wear.compose:compose-foundation:$wearCompose")
    implementation("androidx.wear.compose:compose-navigation:$wearCompose")

    // On-watch text entry (RemoteInput helper)
    implementation("androidx.wear:wear-input:1.2.0")

    // Networking (WebSocket + HTTP)
    implementation("com.squareup.okhttp3:okhttp:5.4.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
}
