package com.claude.watch.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.claude.watch.ChatMsg
import com.claude.watch.Role
import com.claude.watch.WatchViewModel
import com.claude.watch.ui.theme.Clay
import com.claude.watch.ui.theme.Ink
import com.claude.watch.ui.theme.Muted
import com.claude.watch.ui.theme.OnClay
import com.claude.watch.ui.theme.Surface
import com.claude.watch.ui.theme.Surface2

@Composable
fun ChatScreen(vm: WatchViewModel, onVoice: () -> Unit, onKeyboard: () -> Unit) {
    val state = rememberScalingLazyListState()
    val count = vm.messages.size + (if (vm.typing) 1 else 0)
    LaunchedEffect(count) { if (count > 0) runCatching { state.animateScrollToItem(count) } }

    Box(Modifier.fillMaxSize()) {
        ScalingLazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            contentPadding = PaddingValues(top = 40.dp, bottom = 92.dp),
        ) {
            item {
                Text(vm.chatTitle, style = MaterialTheme.typography.caption1, color = Clay, maxLines = 1, fontWeight = FontWeight.SemiBold)
            }
            items(vm.messages.size) { i -> Bubble(vm.messages[i]) }
            if (vm.typing) item { TypingBubble() }
        }

        // Confirmation takes over the screen until answered.
        vm.confirmation?.let { c ->
            ConfirmOverlay(c.tool, c.command, onAllow = { vm.resolveConfirm(true) }, onDeny = { vm.resolveConfirm(false) })
            return@Box
        }

        // Bottom dock: status, suggestion, and speak/type (or stop while running).
        Column(
            Modifier.fillMaxWidth().align(Alignment.BottomCenter).padding(bottom = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (vm.status.isNotEmpty())
                Text(vm.status, style = MaterialTheme.typography.caption2, color = Muted, maxLines = 1)
            vm.suggestion?.let { s ->
                CompactChip(
                    onClick = { vm.sendPrompt(s); vm.suggestion = null },
                    colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface2),
                    label = { Text(s, color = Ink, maxLines = 1) },
                )
            }
            if (vm.running) {
                CompactChip(
                    onClick = { vm.stop() },
                    colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface2),
                    label = { Text("Stop", color = Ink) },
                )
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CompactChip(
                        onClick = onVoice,
                        colors = ChipDefaults.primaryChipColors(backgroundColor = Clay, contentColor = OnClay),
                        label = { Text("Speak", color = OnClay) },
                    )
                    CompactChip(
                        onClick = onKeyboard,
                        colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface2),
                        label = { Text("Type", color = Ink) },
                    )
                }
            }
        }
    }
}

@Composable
private fun Bubble(m: ChatMsg) {
    when (m.role) {
        Role.ME -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            BubbleBox(bg = Clay, fg = OnClay) {
                Text(m.text, color = OnClay, style = MaterialTheme.typography.body2)
            }
        }
        Role.AI -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
            val bg = if (m.filtered) androidx.compose.ui.graphics.Color(0xFF3A201C) else Surface
            val fg = if (m.filtered) androidx.compose.ui.graphics.Color(0xFFF0B3A6) else Ink
            BubbleBox(bg = bg, fg = fg) {
                if (m.streaming) {
                    Text(
                        buildAnnotatedString {
                            append(m.text)
                            withStyle(SpanStyle(color = Clay, fontWeight = FontWeight.Bold)) { append(" ▍") }
                        },
                        color = fg, style = MaterialTheme.typography.body2,
                    )
                } else {
                    Text(m.text, color = fg, style = MaterialTheme.typography.body2)
                }
            }
        }
        Role.TOOL -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
            Box(Modifier.clip(RoundedCornerShape(12.dp)).background(Surface).padding(horizontal = 8.dp, vertical = 5.dp)) {
                Text("⌘ " + m.text, color = Clay, fontFamily = FontFamily.Monospace, fontSize = 11.sp, maxLines = 1)
            }
        }
    }
}

@Composable
private fun BubbleBox(bg: androidx.compose.ui.graphics.Color, fg: androidx.compose.ui.graphics.Color, content: @Composable () -> Unit) {
    Box(
        Modifier.widthIn(max = 168.dp).clip(RoundedCornerShape(18.dp)).background(bg).padding(horizontal = 10.dp, vertical = 7.dp),
    ) { content() }
}

@Composable
private fun TypingBubble() {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Box(Modifier.clip(RoundedCornerShape(16.dp)).background(Surface).padding(horizontal = 12.dp, vertical = 8.dp)) {
            Text("•••", color = Muted)
        }
    }
}

@Composable
private fun ConfirmOverlay(tool: String, command: String, onAllow: () -> Unit, onDeny: () -> Unit) {
    Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xCC0F0E0D)).padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Run $tool?", color = androidx.compose.ui.graphics.Color(0xFFE0B072), fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Box(Modifier.clip(RoundedCornerShape(10.dp)).background(androidx.compose.ui.graphics.Color(0xFF191512)).padding(8.dp)) {
                Text(command, color = androidx.compose.ui.graphics.Color(0xFFF0E5D5), fontFamily = FontFamily.Monospace, fontSize = 11.sp, maxLines = 4)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CompactChip(onClick = onAllow, colors = ChipDefaults.primaryChipColors(backgroundColor = Clay, contentColor = OnClay), label = { Text("Allow", color = OnClay) })
                CompactChip(onClick = onDeny, colors = ChipDefaults.secondaryChipColors(backgroundColor = Surface2), label = { Text("Deny", color = Ink) })
            }
        }
    }
}
