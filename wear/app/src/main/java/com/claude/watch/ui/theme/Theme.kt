package com.claude.watch.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme

// Claude palette (mirrors the web GUI / HarmonyOS design language).
val Clay = Color(0xFFD97757)
val ClayDeep = Color(0xFFC15F3C)
val ClayTint = Color(0x2ED97757)
val OnClay = Color(0xFF2A1A12)
val Bg = Color(0xFF262624)
val Surface = Color(0xFF1F1E1D)
val Surface2 = Color(0xFF34322F)
val Ink = Color(0xFFF7F6F1)
val Muted = Color(0xFFB1ADA1)
val Faint = Color(0xFF86837C)
val Border = Color(0xFF3A3936)
val Ok = Color(0xFF7BBD8A)
val Err = Color(0xFFE0806A)

private val ClaudeColors = Colors(
    primary = Clay,
    primaryVariant = ClayDeep,
    secondary = Surface2,
    background = Bg,
    surface = Surface,
    error = Err,
    onPrimary = OnClay,
    onSecondary = Ink,
    onBackground = Ink,
    onSurface = Ink,
    onError = OnClay,
)

@Composable
fun ClaudeTheme(content: @Composable () -> Unit) {
    val base = MaterialTheme.typography
    val serif = FontFamily.Serif
    val typo = base.copy(
        title1 = base.title1.copy(fontFamily = serif, fontWeight = FontWeight.Medium),
        title2 = base.title2.copy(fontFamily = serif, fontWeight = FontWeight.Medium),
        title3 = base.title3.copy(fontFamily = serif, fontWeight = FontWeight.Medium),
    )
    MaterialTheme(colors = ClaudeColors, typography = typo, content = content)
}
