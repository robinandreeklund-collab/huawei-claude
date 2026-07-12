plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.claude.watch"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.claude.watch"
        minSdk = 30            // Wear OS 3 (Galaxy Watch 4 and later)
        targetSdk = 34         // Android 14 / Wear OS 5 (raise to 35 by 2026-08-31)
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
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    val composeUi = "1.6.8"
    val wearCompose = "1.4.0"

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")

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
    implementation("androidx.wear:wear-input:1.1.0")

    // Networking (WebSocket + HTTP)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
