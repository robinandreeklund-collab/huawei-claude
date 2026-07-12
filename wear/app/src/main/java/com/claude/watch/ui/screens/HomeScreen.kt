package com.claude.watch.ui.screens

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Text
import com.claude.watch.Scope
import com.claude.watch.WatchViewModel
import com.claude.watch.ui.theme.Clay
import com.claude.watch.ui.theme.Faint
import com.claude.watch.ui.theme.Ink
import com.claude.watch.ui.theme.Muted
import com.claude.watch.ui.theme.Surface

@Composable
fun HomeScreen(vm: WatchViewModel) {
    val state = rememberScalingLazyListState()
    ScalingLazyColumn(
        state = state,
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(top = 34.dp, bottom = 44.dp),
    ) {
        items(Scope.entries.toList()) { scope ->
            Chip(
                onClick = { vm.openScope(scope) },
                modifier = Modifier.fillMaxWidth(),
                colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface),
                label = { Text(scope.title, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                secondaryLabel = { Text(scope.subtitle, color = Faint, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            )
        }
        item {
            Chip(
                onClick = { vm.openSettings() },
                modifier = Modifier.fillMaxWidth(),
                colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface),
                label = { Text("Settings", color = Muted, maxLines = 1) },
            )
        }
        item { Text("·", color = Clay) }
    }
}
