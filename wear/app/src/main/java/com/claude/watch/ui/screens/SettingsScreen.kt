package com.claude.watch.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Switch
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.ToggleChip
import androidx.wear.compose.material.ToggleChipDefaults
import com.claude.watch.WatchViewModel
import com.claude.watch.ui.theme.Clay
import com.claude.watch.ui.theme.Faint
import com.claude.watch.ui.theme.Ink
import com.claude.watch.ui.theme.Muted
import com.claude.watch.ui.theme.OnClay
import com.claude.watch.ui.theme.Surface
import com.claude.watch.ui.theme.Surface2

@Composable
fun SettingsScreen(vm: WatchViewModel) {
    val state = rememberScalingLazyListState()
    val langs = listOf("" to "Auto", "svenska" to "SV", "english" to "EN")

    ScalingLazyColumn(
        state = state,
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(top = 30.dp, bottom = 44.dp),
    ) {
        item { Text("Settings", style = MaterialTheme.typography.title3, color = Ink) }

        item {
            val acct = vm.account
            Chip(
                onClick = {},
                modifier = Modifier.fillMaxWidth(),
                colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface),
                label = { Text(acct?.email ?: "Signed in", color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                secondaryLabel = { Text(acct?.plan ?: "verifying…", color = Clay, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            )
        }

        item { Text("Language", style = MaterialTheme.typography.caption2, color = Muted) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                langs.forEach { (code, label) ->
                    val on = vm.settings.language == code
                    CompactChip(
                        onClick = { vm.setLanguage(code) },
                        colors = if (on) ChipDefaults.primaryChipColors(backgroundColor = Clay, contentColor = OnClay)
                                 else ChipDefaults.secondaryChipColors(backgroundColor = Surface2),
                        label = { Text(label, color = if (on) OnClay else Ink) },
                    )
                }
            }
        }

        item {
            ToggleChip(
                checked = vm.settings.planMode,
                onCheckedChange = { vm.setPlanMode(it) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Plan mode", color = Ink) },
                secondaryLabel = { Text("review before edits", color = Faint) },
                toggleControl = { Switch(checked = vm.settings.planMode) },
                colors = ToggleChipDefaults.toggleChipColors(checkedToggleControlColor = Clay),
            )
        }
        item {
            ToggleChip(
                checked = vm.settings.notifications,
                onCheckedChange = { vm.setNotifications(it) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Notifications", color = Ink) },
                toggleControl = { Switch(checked = vm.settings.notifications) },
                colors = ToggleChipDefaults.toggleChipColors(checkedToggleControlColor = Clay),
            )
        }

        item {
            Chip(
                onClick = {},
                modifier = Modifier.fillMaxWidth(),
                colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface),
                label = { Text("Server", color = Muted, maxLines = 1) },
                secondaryLabel = { Text(vm.connectHost, color = Faint, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            )
        }
    }
}
