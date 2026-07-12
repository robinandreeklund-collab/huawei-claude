package com.claude.watch.ui.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.claude.watch.ui.SparkLogo
import com.claude.watch.ui.theme.Ink

@Composable
fun SplashScreen() {
    val t = rememberInfiniteTransition(label = "splash")
    val rot by t.animateFloat(
        0f, 360f,
        infiniteRepeatable(tween(18000, easing = LinearEasing)), label = "rot",
    )
    val glow by t.animateFloat(
        0.9f, 1.08f,
        infiniteRepeatable(tween(2400, easing = LinearEasing), RepeatMode.Reverse), label = "glow",
    )
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(84.dp).scale(glow), contentAlignment = Alignment.Center) {
                Box(Modifier.rotate(rot)) { SparkLogo(74.dp) }
            }
            Text("Claude", style = MaterialTheme.typography.title2, color = Ink)
            Box(Modifier.height(6.dp))
        }
    }
}
