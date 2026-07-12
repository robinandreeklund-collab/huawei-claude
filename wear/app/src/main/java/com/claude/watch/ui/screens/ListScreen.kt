package com.claude.watch.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.claude.watch.Scope
import com.claude.watch.WatchViewModel
import com.claude.watch.ui.theme.Clay
import com.claude.watch.ui.theme.Faint
import com.claude.watch.ui.theme.Ink
import com.claude.watch.ui.theme.OnClay
import com.claude.watch.ui.theme.Surface

@Composable
fun ListScreen(vm: WatchViewModel) {
    val scope = vm.currentScope ?: Scope.CHATS
    val items = vm.listItems
    val state = rememberScalingLazyListState()

    if (items == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(indicatorColor = Clay, strokeWidth = 3.dp)
        }
        return
    }

    ScalingLazyColumn(
        state = state,
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(top = 30.dp, bottom = 44.dp),
    ) {
        item { Text(scope.title, style = MaterialTheme.typography.title3, color = Ink) }

        if (scope == Scope.CHATS) {
            item {
                Chip(
                    onClick = { vm.newChat() },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ChipDefaults.primaryChipColors(backgroundColor = Clay, contentColor = OnClay),
                    label = { Text("New chat", color = OnClay) },
                )
            }
        }

        if (items.isEmpty()) {
            item { Text("Nothing here yet", color = Faint, style = MaterialTheme.typography.caption2) }
        } else {
            items(items) { it ->
                Chip(
                    onClick = { vm.openItem(scope, it.id) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface),
                    label = { Text(it.title, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = {
                        if (it.subtitle.isNotEmpty())
                            Text(it.subtitle, color = Faint, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    },
                )
            }
        }
    }
}
