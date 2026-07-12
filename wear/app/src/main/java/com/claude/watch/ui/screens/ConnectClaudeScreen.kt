package com.claude.watch.ui.screens

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.claude.watch.WatchViewModel
import com.claude.watch.ui.QrImage
import com.claude.watch.ui.theme.Clay
import com.claude.watch.ui.theme.Ink
import com.claude.watch.ui.theme.Muted

/** Shown when the watch is paired but no Claude credential is connected yet. */
@Composable
fun ConnectClaudeScreen(vm: WatchViewModel) {
    val state = rememberScalingLazyListState()
    val qrSize = (LocalConfiguration.current.screenWidthDp * 0.56f).dp.coerceIn(104.dp, 132.dp)
    ScalingLazyColumn(
        state = state,
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(top = 26.dp, bottom = 40.dp),
    ) {
        item { Text("Connect Claude", style = MaterialTheme.typography.title3, color = Ink) }
        item { QrImage(vm.connectQr, qrSize) }
        item {
            Text(
                "Scan to open",
                style = MaterialTheme.typography.caption2, color = Muted,
                textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 18.dp),
            )
        }
        item { Text(vm.connectHost + "/connect", style = MaterialTheme.typography.caption1, color = Clay, fontWeight = FontWeight.SemiBold) }
        item {
            Text(
                "on your phone and paste your Claude token once.",
                style = MaterialTheme.typography.caption2, color = Muted,
                textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 18.dp),
            )
        }
    }
}
