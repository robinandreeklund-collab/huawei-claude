package com.claude.watch.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Thin HTTP client for the device-flow login + connect-status endpoints. */
class Api(private val base: String) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun post(path: String, body: JSONObject = JSONObject()): JSONObject =
        withContext(Dispatchers.IO) {
            val req = Request.Builder().url(base + path)
                .post(body.toString().toRequestBody(jsonType)).build()
            http.newCall(req).execute().use { r -> parse(r.body.string()) }
        }

    suspend fun get(path: String): JSONObject =
        withContext(Dispatchers.IO) {
            val req = Request.Builder().url(base + path).get().build()
            http.newCall(req).execute().use { r -> parse(r.body.string()) }
        }

    private fun parse(s: String?): JSONObject =
        try { JSONObject(if (s.isNullOrEmpty()) "{}" else s) } catch (_: Exception) { JSONObject() }
}
