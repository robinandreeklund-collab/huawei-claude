package com.claude.watch.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.CircularProgressIndicator
import com.claude.watch.ui.theme.Clay

/** The Claude spark — the same 4-point mark used across the web/HarmonyOS GUIs. */
@Composable
fun SparkLogo(size: Dp, color: Color = Clay) {
    Canvas(modifier = Modifier.size(size)) {
        val s = this.size.minDimension
        val k = s / 108f
        fun v(x: Float) = x * k
        val path = Path().apply {
            moveTo(v(54f), v(30f))
            cubicTo(v(56f), v(48f), v(60f), v(52f), v(78f), v(54f))
            cubicTo(v(60f), v(56f), v(56f), v(60f), v(54f), v(78f))
            cubicTo(v(52f), v(60f), v(48f), v(56f), v(30f), v(54f))
            cubicTo(v(48f), v(52f), v(52f), v(48f), v(54f), v(30f))
            close()
        }
        drawPath(path, color)
    }
}

/** A QR code delivered by the backend as a base64 PNG, on a white card. */
@Composable
fun QrImage(bmp: Bitmap?, size: Dp) {
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(14.dp))
            .background(Color.White)
            .padding(5.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (bmp != null) {
            Image(bitmap = bmp.asImageBitmap(), contentDescription = "QR code", modifier = Modifier.size(size - 10.dp))
        } else {
            CircularProgressIndicator(indicatorColor = Clay, strokeWidth = 3.dp)
        }
    }
}
