package com.claude.watch

import android.app.Application
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.claude.watch.net.Api
import com.claude.watch.net.WsClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Owns the connection + all UI state. The watch is a thin client: this drives the
 * device-flow QR login, the WebSocket to the relay, and renders the exact same
 * protocol the web GUI uses. No Claude logic lives here — the backend does that.
 */
class WatchViewModel(app: Application) : AndroidViewModel(app) {

    private var base = Config.baseUrl(app)
    private var api = Api(base)
    private var ws: WsClient? = null

    // --- Observable UI state ------------------------------------------------
    var route by mutableStateOf(Route.SPLASH); private set
    var status by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
    var running by mutableStateOf(false)
    var typing by mutableStateOf(false)

    var userCode by mutableStateOf("")
    var pairQr by mutableStateOf<Bitmap?>(null)
    var connectQr by mutableStateOf<Bitmap?>(null)
    var connectHost by mutableStateOf(Config.host(base))

    var currentScope by mutableStateOf<Scope?>(null)
    var listItems by mutableStateOf<List<ListItem>?>(null)   // null = loading
    val messages = mutableStateListOf<ChatMsg>()
    var chatTitle by mutableStateOf("Claude")
    var suggestion by mutableStateOf<String?>(null)
    var confirmation by mutableStateOf<Confirmation?>(null)
    var banner by mutableStateOf<Pair<String, String>?>(null)

    var settings by mutableStateOf(Settings())
    var account by mutableStateOf<AccountInfo?>(null)

    // --- Internals ----------------------------------------------------------
    private var token: String? = null
    private var deviceCode: String? = null
    private var claudeConnected = false
    private var streamingKey: Long? = null
    private var pollJob: Job? = null
    private var connectJob: Job? = null
    private var reconnectJob: Job? = null
    private var reconnectAttempt = 0
    private var booted = false

    fun start() {
        if (route != Route.SPLASH) return
        viewModelScope.launch {
            delay(1400)                 // let the splash breathe
            startPairing()
        }
    }

    // ---- Device-flow login (QR on watch → approve on phone) ----------------
    private fun startPairing() {
        pollJob?.cancel()
        viewModelScope.launch {
            try {
                val dc = api.post("/device/code")
                deviceCode = dc.optString("device_code")
                userCode = dc.optString("user_code")
                pairQr = decodeDataUrl(dc.optString("qr_data_url"))
                route = Route.PAIRING
                buzz(longArrayOf(18, 40, 24))
                pollToken(dc.optInt("interval", 3).coerceAtLeast(2))
            } catch (e: Exception) {
                error = "Can't reach ${Config.host(base)}"
                route = Route.PAIRING
            }
        }
    }

    private fun pollToken(intervalS: Int) {
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            while (true) {
                delay(intervalS * 1000L)
                val dcode = deviceCode ?: return@launch
                val res = try { api.post("/device/token", JSONObject().put("device_code", dcode)) }
                catch (_: Exception) { continue }
                when (res.optString("status")) {
                    "approved" -> { token = res.optString("access_token"); connectWs(); return@launch }
                    "expired_token" -> { startPairing(); return@launch }
                }
            }
        }
    }

    // ---- WebSocket ---------------------------------------------------------
    private fun connectWs() {
        ws?.close()
        ws = WsClient(
            url = Config.wsUrl(base),
            onOpen = { onMain { ws?.send("auth") { put("token", token) } } },
            onEvent = { o -> onMain { handle(o) } },
            onClosed = { onMain { scheduleReconnect() } },
        ).also { it.connect() }
    }

    private fun scheduleReconnect() {
        if (token == null || reconnectJob?.isActive == true) return
        // Exponential backoff (2.5s → 5 → 10 → 20, capped at 30s) to spare the
        // battery during longer outages. Reset once we're authed again.
        val delayMs = (2500L shl reconnectAttempt.coerceAtMost(4)).coerceAtMost(30_000L)
        reconnectAttempt++
        reconnectJob = viewModelScope.launch {
            delay(delayMs)
            if (token != null) connectWs()
        }
    }

    private fun handle(o: JSONObject) {
        when (o.optString("type")) {
            "authed" -> {
                reconnectAttempt = 0
                claudeConnected = o.optBoolean("claude")
                val consented = o.optBoolean("consented")
                settings = settings.copy(planMode = o.optBoolean("planMode"))
                if (!booted) {
                    booted = true
                    when {
                        !consented -> route = Route.CONSENT
                        !claudeConnected -> gotoConnectClaude()
                        else -> route = Route.HOME
                    }
                }
            }
            "consented", "needs_consent" -> afterConsent()
            "list_result" -> {
                val scope = o.optString("scope")
                if (currentScope?.key == scope) listItems = parseItems(o.optJSONArray("items"))
            }
            "chat_opened" -> {
                chatTitle = o.optString("context", "Claude")
                messages.clear(); streamingKey = null; typing = false; running = false
                suggestion = null; confirmation = null
                route = Route.CHAT
            }
            "history" -> {
                val arr = o.optJSONArray("items") ?: return
                for (i in 0 until arr.length()) {
                    val it = arr.optJSONObject(i) ?: continue
                    val role = if (it.optString("role") == "user") Role.ME else Role.AI
                    messages.add(ChatMsg(role, it.optString("text")))
                }
            }
            "accepted" -> { suggestion = null; typing = true; running = true }
            "stream_start" -> startStream()
            "stream_delta" -> appendStream(o.optString("text"))
            "stream_filter" -> filterStream()
            "stream_end" -> endStream()
            "assistant" -> reconcileAssistant(o)
            "tool_use" -> { typing = false; addMsg(Role.TOOL, o.optString("name")); typing = true }
            "progress" -> status = o.optString("text")
            "suggestion" -> o.optString("text").takeIf { it.isNotEmpty() }?.let { suggestion = it }
            "needs_confirmation" -> {
                typing = false
                confirmation = Confirmation(o.optString("id"), o.optString("tool"), o.optString("command"))
            }
            "turn_done" -> { typing = false; running = false; status = ""; buzz(longArrayOf(16, 40, 22)) }
            "stopped" -> { running = false; typing = false; status = "" }
            "plan_mode" -> settings = settings.copy(planMode = o.optBoolean("on"))
            "model_set" -> banner = "Model" to prettyModel(o.optString("model", "default"))
            "settings_result" -> settings = Settings(
                language = o.optString("language", ""),
                planMode = o.optBoolean("planMode"),
                notifications = o.optBoolean("notifications", true),
            )
            "account_result" -> account = parseAccount(o.optJSONObject("account"))
            "session_renamed", "session_deleted" -> currentScope?.let { refreshList(it) }
            "watch_action" -> watchAction(o)
            "watch_query" -> watchQuery(o)
            "error" -> onError(o.optString("message"))
        }
    }

    // ---- Streaming ---------------------------------------------------------
    private fun startStream() {
        typing = false
        val m = ChatMsg(Role.AI, "", streaming = true)
        messages.add(m); streamingKey = m.key
    }
    private fun appendStream(text: String) {
        val key = streamingKey ?: run { startStream(); streamingKey }
        val i = indexOf(key ?: return); if (i < 0) return
        val cur = messages[i]
        messages[i] = cur.copy(text = cur.text + text)  // reassign → recomposition
    }
    private fun filterStream() {
        val i = indexOf(streamingKey ?: return); if (i < 0) return
        messages[i] = messages[i].copy(text = "…", filtered = true, streaming = false)
    }
    private fun endStream() {
        val i = indexOf(streamingKey ?: return); if (i < 0) return
        messages[i] = messages[i].copy(streaming = false)
    }
    private fun reconcileAssistant(o: JSONObject) {
        val text = o.optString("text"); val filtered = o.optBoolean("filtered")
        val streamed = o.optBoolean("streamed")
        val i = if (streamed) indexOf(streamingKey ?: -1L) else -1
        if (i >= 0) {
            messages[i] = messages[i].copy(
                text = text.ifEmpty { messages[i].text },
                filtered = filtered, report = !filtered, streaming = false,
            )
            streamingKey = null
        } else {
            addMsg(Role.AI, text, filtered = filtered, report = !filtered)
        }
    }

    // ---- Actions from the UI ----------------------------------------------
    fun consent() { ws?.send("consent") }
    private fun afterConsent() {
        stopConnectPoll()
        if (!claudeConnected) gotoConnectClaude() else route = Route.HOME
    }

    fun sendPrompt(text: String) {
        val t = text.trim(); if (t.isEmpty()) return
        addMsg(Role.ME, t)
        ws?.send("prompt") { put("text", t) }
    }
    fun stop() = ws?.send("stop") ?: Unit
    fun resolveConfirm(allow: Boolean) {
        val c = confirmation ?: return
        ws?.send("confirm") { put("id", c.id); put("allow", allow) }
        confirmation = null
    }
    fun openScope(scope: Scope) {
        currentScope = scope; listItems = null; route = Route.LIST
        ws?.send("list") { put("scope", scope.key) }
    }
    private fun refreshList(scope: Scope) = ws?.send("list") { put("scope", scope.key) } ?: Unit
    fun newChat() { ws?.send("new_chat") }
    fun openItem(scope: Scope, id: String) {
        val type = when (scope) {
            Scope.CHATS -> "open_chat"; Scope.PROJECTS -> "open_project"; Scope.CODE -> "open_code"
        }
        ws?.send(type) { put("id", id) }
    }
    fun openSettings() { route = Route.SETTINGS; ws?.send("settings_get"); ws?.send("account") }
    fun setPlanMode(on: Boolean) { ws?.send("plan_mode") { put("on", on) } }
    fun setLanguage(lang: String) { settings = settings.copy(language = lang); ws?.send("set_language") { put("lang", lang) } }
    fun setNotifications(on: Boolean) { settings = settings.copy(notifications = on); ws?.send("set_notifications") { put("on", on) } }
    fun report(text: String) { ws?.send("report") { put("reason", "user_report"); put("text", text) } }
    fun dismissBanner() { banner = null }

    /** Server URL edited on the pairing or settings screen — persist, tear down the
     *  current session, and start a fresh pairing against the new backend. The
     *  ViewModel survives Activity recreation, so we must rebuild `api`/`ws` here
     *  ourselves rather than relying on a restart. */
    fun setServer(url: String) {
        if (url.isBlank()) return
        val ctx: Context = getApplication()
        Config.setBaseUrl(ctx, url)
        val newBase = Config.baseUrl(ctx)
        if (newBase == base) return

        // Tear down the old connection and any in-flight polling.
        pollJob?.cancel(); connectJob?.cancel(); reconnectJob?.cancel()
        ws?.close(); ws = null

        // Point at the new backend.
        base = newBase
        api = Api(base)
        connectHost = Config.host(base)

        // Reset session + UI state, then pair from scratch.
        token = null; deviceCode = null; claudeConnected = false
        booted = false; streamingKey = null
        messages.clear(); listItems = null; currentScope = null
        suggestion = null; confirmation = null; banner = null
        error = null; status = ""; running = false; typing = false
        userCode = ""; pairQr = null; connectQr = null
        route = Route.SPLASH
        startPairing()
    }

    fun onBack(): Boolean = when (route) {
        Route.CHAT -> { route = if (currentScope != null) Route.LIST else Route.HOME; true }
        Route.LIST -> { route = Route.HOME; true }
        Route.SETTINGS -> { route = Route.HOME; true }
        else -> false   // PAIRING/CONNECT/CONSENT/HOME/SPLASH → let the OS exit
    }

    // ---- Connect-Claude waiting screen ------------------------------------
    private fun gotoConnectClaude() {
        route = Route.CONNECT_CLAUDE
        viewModelScope.launch {
            try {
                val d = api.get("/connect/qr")
                connectQr = decodeDataUrl(d.optString("qr_data_url"))
                connectHost = d.optString("url").removePrefix("https://").removePrefix("http://").ifEmpty { Config.host(base) }
            } catch (_: Exception) {}
        }
        startConnectPoll()
    }
    private fun startConnectPoll() {
        connectJob?.cancel()
        connectJob = viewModelScope.launch {
            while (true) {
                delay(3000)
                val s = try { api.get("/connect/status") } catch (_: Exception) { continue }
                if (s.optBoolean("connected")) {
                    claudeConnected = true; buzz(longArrayOf(18, 40, 24)); route = Route.HOME; return@launch
                }
            }
        }
    }
    private fun stopConnectPoll() { connectJob?.cancel(); connectJob = null }

    // ---- Watch tools (Claude acting on the watch) -------------------------
    private fun watchAction(o: JSONObject) {
        when (o.optString("action")) {
            "vibrate" -> buzz(when (o.optString("pattern")) {
                "double" -> longArrayOf(18, 40, 24); "long" -> longArrayOf(320); else -> longArrayOf(24)
            })
            "notify" -> { banner = o.optString("title") to o.optString("body"); buzz(longArrayOf(18, 40, 24)) }
            "timer" -> { banner = "Timer" to "${o.optInt("seconds")}s · ${o.optString("label")}"; buzz(longArrayOf(24)) }
        }
    }
    private fun watchQuery(o: JSONObject) {
        val id = o.optString("id")
        val data = JSONObject()
        if (o.optString("kind") == "location") {
            data.put("lat", 59.334).put("lon", 18.063).put("place", "Stockholm, SE")
            banner = "Location" to "Stockholm, SE"
        } else {
            val hr = 62 + (0..25).random(); val steps = 3500 + (0..4200).random()
            data.put("heartRate", hr).put("steps", steps)
            banner = "Health" to "$hr bpm · $steps steps"
        }
        ws?.send("watch_reply") { put("id", id); put("data", data) }
        buzz(longArrayOf(12))
    }

    // ---- Helpers -----------------------------------------------------------
    private fun onError(msg: String) {
        when {
            msg.contains("invalid or expired token", true) -> {
                token = null; reconnectJob?.cancel(); booted = false; ws?.close(); startPairing()
            }
            msg.contains("not connected", true) -> { claudeConnected = false; gotoConnectClaude() }
            else -> error = msg
        }
    }
    private fun addMsg(role: Role, text: String, filtered: Boolean = false, report: Boolean = false) {
        messages.add(ChatMsg(role, text, filtered = filtered, report = report))
    }
    private fun indexOf(key: Long): Int = messages.indexOfLast { it.key == key }
    private fun onMain(block: () -> Unit) = viewModelScope.launch(Dispatchers.Main.immediate) { block() }

    private fun decodeDataUrl(dataUrl: String?): Bitmap? {
        if (dataUrl.isNullOrEmpty()) return null
        val comma = dataUrl.indexOf(','); if (comma < 0) return null
        return try {
            val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) { null }
    }
    private fun parseItems(arr: org.json.JSONArray?): List<ListItem> {
        val out = ArrayList<ListItem>()
        if (arr != null) for (i in 0 until arr.length()) {
            val it = arr.optJSONObject(i) ?: continue
            out.add(ListItem(it.optString("id"), it.optString("title", "Untitled"), it.optString("subtitle", "")))
        }
        return out
    }
    private fun parseAccount(a: JSONObject?): AccountInfo? {
        if (a == null) return null
        val email = a.optString("email", "").ifEmpty { null }
        val plan = a.optString("subscriptionType", "").ifEmpty {
            if (a.optString("apiProvider") == "firstParty") "Claude subscription" else a.optString("apiProvider", "").ifEmpty { null }
        }
        return AccountInfo(email, plan?.replace('_', ' '))
    }
    private fun prettyModel(m: String): String =
        m.replace(Regex("^claude-|-\\d+$"), "").replace('-', ' ').ifEmpty { "default" }

    private fun buzz(pattern: LongArray) {
        val ctx: Context = getApplication()
        val v: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                v?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, *pattern), -1))
            else @Suppress("DEPRECATION") v?.vibrate(pattern, -1)
        } catch (_: Exception) {}
    }

    override fun onCleared() { ws?.close(); super.onCleared() }
}
