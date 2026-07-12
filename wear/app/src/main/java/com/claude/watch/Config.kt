package com.claude.watch

import android.content.Context

/** Where the relay backend lives. Baked default from BuildConfig, overridable at
 *  runtime (persisted) via the ⚙ Server field on the pairing screen. */
object Config {
    private const val PREFS = "claude_watch"
    private const val KEY_BASE = "base_url"

    fun baseUrl(ctx: Context): String {
        val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val override = sp.getString(KEY_BASE, null)?.trim()
        val chosen = if (override.isNullOrEmpty()) BuildConfig.DEFAULT_BASE_URL else override
        return normalize(chosen)
    }

    fun setBaseUrl(ctx: Context, url: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_BASE, normalize(url)).apply()
    }

    private fun normalize(u: String): String {
        var s = u.trim().removeSuffix("/")
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
        return s
    }

    fun wsUrl(base: String): String =
        (if (base.startsWith("https://")) base.replaceFirst("https://", "wss://")
         else base.replaceFirst("http://", "ws://")) + "/ws"

    fun host(base: String): String =
        base.removePrefix("https://").removePrefix("http://")
}
