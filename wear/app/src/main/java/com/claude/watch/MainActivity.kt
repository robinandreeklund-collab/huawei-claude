package com.claude.watch

import android.Manifest
import android.app.RemoteInput
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.wear.input.RemoteInputIntentHelper
import com.claude.watch.ui.App
import com.claude.watch.ui.theme.ClaudeTheme

class MainActivity : ComponentActivity() {

    private val vm: WatchViewModel by viewModels()

    private val voiceLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val text = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!text.isNullOrBlank()) vm.sendPrompt(text)
    }
    private val micPermLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRecognizer()
    }
    private val messageLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        remoteText(r, KEY_MSG)?.let { vm.sendPrompt(it) }
    }
    private val serverLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        remoteText(r, KEY_SRV)?.let { url -> vm.setServer(url) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ClaudeTheme {
                App(
                    vm = vm,
                    onVoice = ::onVoice,
                    onKeyboard = { launchRemoteInput(messageLauncher, KEY_MSG, "Message") },
                    onEditServer = { launchRemoteInput(serverLauncher, KEY_SRV, "Server URL") },
                    onExit = { finish() },
                )
            }
        }
        vm.start()
    }

    private fun onVoice() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            startRecognizer()
        else micPermLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }

    private fun startRecognizer() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to Claude")
        }
        try { voiceLauncher.launch(intent) } catch (_: Exception) {}
    }

    private fun launchRemoteInput(
        launcher: androidx.activity.result.ActivityResultLauncher<Intent>,
        key: String, label: String,
    ) {
        val remoteInputs = listOf(RemoteInput.Builder(key).setLabel(label).build())
        val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
        RemoteInputIntentHelper.putRemoteInputsExtra(intent, remoteInputs)
        try { launcher.launch(intent) } catch (_: Exception) {}
    }

    private fun remoteText(r: ActivityResult, key: String): String? {
        val data = r.data ?: return null
        return RemoteInput.getResultsFromIntent(data)?.getCharSequence(key)?.toString()?.trim()?.ifEmpty { null }
    }

    companion object {
        private const val KEY_MSG = "msg"
        private const val KEY_SRV = "srv"
    }
}
