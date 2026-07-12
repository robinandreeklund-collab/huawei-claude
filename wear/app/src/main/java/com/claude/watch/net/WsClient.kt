package com.claude.watch.net

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** WebSocket to the relay. Callbacks fire on OkHttp threads — the ViewModel
 *  marshals them onto the main dispatcher. */
class WsClient(
    private val url: String,
    private val onOpen: () -> Unit,
    private val onEvent: (JSONObject) -> Unit,
    private val onClosed: () -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    private var ws: WebSocket? = null
    @Volatile private var closedByUs = false

    fun connect() {
        closedByUs = false
        val req = Request.Builder().url(url).build()
        ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = onOpen()
            override fun onMessage(webSocket: WebSocket, text: String) {
                try { onEvent(JSONObject(text)) } catch (_: Exception) {}
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!closedByUs) onClosed()
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (!closedByUs) onClosed()
            }
        })
    }

    fun send(obj: JSONObject) { ws?.send(obj.toString()) }

    fun send(type: String, build: JSONObject.() -> Unit = {}) =
        send(JSONObject().put("type", type).apply(build))

    fun close() {
        closedByUs = true
        ws?.close(1000, null)
        ws = null
    }
}
