package com.claude.watch.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
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

@Composable
fun ConsentScreen(vm: WatchViewModel) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 26.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        SparkLogo(34.dp)
        Text("Before we start", style = MaterialTheme.typography.title3, color = Ink, modifier = Modifier.padding(top = 8.dp))
        Text(
            "What you say is sent to the backend and Anthropic to run Claude Code.",
            style = MaterialTheme.typography.caption2, color = Muted,
            textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 8.dp),
        )
        Button(
            onClick = { vm.consent() },
            colors = ButtonDefaults.buttonColors(backgroundColor = Clay, contentColor = OnClay),
        ) { Text("Agree", color = OnClay) }
    }
}
