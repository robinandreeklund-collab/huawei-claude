package com.claude.watch.ui.screens

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.claude.watch.WatchViewModel
import com.claude.watch.ui.QrImage
import com.claude.watch.ui.theme.Ink
import com.claude.watch.ui.theme.Muted

@Composable
fun PairingScreen(vm: WatchViewModel, onEditServer: () -> Unit) {
    val state = rememberScalingLazyListState()
    // Scale the QR to the screen: ~56% of width, clamped so it stays scannable on
    // the smallest round faces and doesn't dominate the largest ones.
    val qrSize = (LocalConfiguration.current.screenWidthDp * 0.56f).dp.coerceIn(104.dp, 132.dp)
    ScalingLazyColumn(
        state = state,
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(top = 26.dp, bottom = 40.dp),
    ) {
        item { Text("Pair", style = MaterialTheme.typography.title2, color = Ink) }
        item { QrImage(vm.pairQr, qrSize) }
        item {
            Text(
                vm.userCode.ifEmpty { "· · · ·" },
                style = MaterialTheme.typography.title3, color = Ink,
                modifier = Modifier.padding(vertical = 2.dp),
            )
        }
        item {
            Text(
                "Scan with your phone and approve.",
                style = MaterialTheme.typography.caption2, color = Muted,
                textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 20.dp),
            )
        }
        item {
            CompactChip(
                onClick = onEditServer,
                label = {
                    Text("⚙ " + vm.connectHost, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Muted)
                },
            )
        }
    }
}
