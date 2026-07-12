package com.claude.watch.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import com.claude.watch.Route
import com.claude.watch.WatchViewModel
import com.claude.watch.ui.screens.ChatScreen
import com.claude.watch.ui.screens.ConnectClaudeScreen
import com.claude.watch.ui.screens.ConsentScreen
import com.claude.watch.ui.screens.HomeScreen
import com.claude.watch.ui.screens.ListScreen
import com.claude.watch.ui.screens.PairingScreen
import com.claude.watch.ui.screens.SettingsScreen
import com.claude.watch.ui.screens.SplashScreen
import com.claude.watch.ui.theme.Err
import com.claude.watch.ui.theme.Ink
import com.claude.watch.ui.theme.Muted
import com.claude.watch.ui.theme.Surface2

@Composable
fun App(
    vm: WatchViewModel,
    onVoice: () -> Unit,
    onKeyboard: () -> Unit,
    onEditServer: () -> Unit,
    onExit: () -> Unit,
) {
    BackHandler(enabled = true) { if (!vm.onBack()) onExit() }

    Scaffold(
        timeText = { if (vm.route != Route.SPLASH && vm.route != Route.CHAT) TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
    ) {
        when (vm.route) {
            Route.SPLASH -> SplashScreen()
            Route.PAIRING -> PairingScreen(vm, onEditServer)
            Route.CONNECT_CLAUDE -> ConnectClaudeScreen(vm)
            Route.CONSENT -> ConsentScreen(vm)
            Route.HOME -> HomeScreen(vm)
            Route.LIST -> ListScreen(vm)
            Route.CHAT -> ChatScreen(vm, onVoice, onKeyboard)
            Route.SETTINGS -> SettingsScreen(vm, onEditServer)
        }

        vm.banner?.let { (title, body) ->
            LaunchedEffect(title, body) { kotlinx.coroutines.delay(2800); vm.dismissBanner() }
            Box(Modifier.fillMaxSize().padding(top = 30.dp), contentAlignment = Alignment.TopCenter) {
                Column(
                    Modifier.fillMaxWidth(0.82f).clip(RoundedCornerShape(18.dp))
                        .background(Surface2).padding(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(title, color = Ink, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (body.isNotEmpty())
                        Text(body, color = Muted, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }

        vm.error?.let { msg ->
            LaunchedEffect(msg) { kotlinx.coroutines.delay(3200); vm.error = null }
            Box(Modifier.fillMaxSize().padding(bottom = 26.dp), contentAlignment = Alignment.BottomCenter) {
                Text(
                    msg, color = Err, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth(0.82f).clip(RoundedCornerShape(14.dp))
                        .background(androidx.compose.ui.graphics.Color(0xFF2A1A16)).padding(8.dp),
                )
            }
        }
    }
}
