package com.claude.watch.ui.screens

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.claude.watch.WatchViewModel
import com.claude.watch.ui.SparkLogo
import com.claude.watch.ui.theme.Clay
import com.claude.watch.ui.theme.Ink
import com.claude.watch.ui.theme.Muted
import com.claude.watch.ui.theme.OnClay

/** Scrollable so the "Agree" button is always reachable, even on the smallest
 *  round screens (≈360–396 px) where a fixed centered column would clip it. */
@Composable
fun ConsentScreen(vm: WatchViewModel) {
    val state = rememberScalingLazyListState()
    ScalingLazyColumn(
        state = state,
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(top = 30.dp, bottom = 40.dp),
    ) {
        item { SparkLogo(34.dp) }
        item {
            Text(
                "Before we start", style = MaterialTheme.typography.title3, color = Ink,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
        item {
            Text(
                "What you say is sent to the backend and Anthropic to run Claude Code.",
                style = MaterialTheme.typography.caption2, color = Muted,
                textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 8.dp, horizontal = 20.dp),
            )
        }
        item {
            Button(
                onClick = { vm.consent() },
                colors = ButtonDefaults.buttonColors(backgroundColor = Clay, contentColor = OnClay),
            ) { Text("Agree", color = OnClay) }
        }
    }
}
