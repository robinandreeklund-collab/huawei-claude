package com.claude.watch

enum class Route { SPLASH, PAIRING, CONNECT_CLAUDE, CONSENT, HOME, LIST, CHAT, SETTINGS }

enum class Role { ME, AI, TOOL }

data class ListItem(val id: String, val title: String, val subtitle: String)

data class ChatMsg(
    val role: Role,
    var text: String,
    var streaming: Boolean = false,
    var filtered: Boolean = false,
    var report: Boolean = false,
    val key: Long = nextKey(),
) {
    companion object {
        private var counter = 0L
        fun nextKey(): Long = ++counter
    }
}

data class Confirmation(val id: String, val tool: String, val command: String)

data class AccountInfo(val email: String?, val plan: String?)

data class Settings(
    val language: String = "",
    val planMode: Boolean = false,
    val notifications: Boolean = true,
)

/** A scope shown on Home; maps to the backend's three Claude surfaces. */
enum class Scope(val key: String, val title: String, val subtitle: String) {
    CHATS("chats", "Chats", "your conversations"),
    PROJECTS("projects", "Projects", "your projects"),
    CODE("code", "Claude Code", "code sessions"),
}
