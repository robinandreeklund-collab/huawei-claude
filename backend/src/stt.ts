// Speech-to-text adapter (fas 2).
//
// HarmonyOS on-device STT only supports Mandarin, so Swedish/English voice must
// be transcribed server-side (see teknisk-spec §3). This posts the audio the
// watch recorded to any OpenAI-compatible /audio/transcriptions endpoint.

import { config, sttConfigured } from "./config.js";

export class SttNotConfiguredError extends Error {
  constructor() {
    super("STT is not configured (set STT_API_URL and STT_API_KEY)");
  }
}

/**
 * Transcribe recorded audio to text.
 * @param audio raw bytes as recorded by the client (e.g. webm/opus, wav)
 * @param mime  the recording's MIME type, used for the multipart filename
 */
export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  if (!sttConfigured()) throw new SttNotConfiguredError();

  const ext = mime.includes("wav") ? "wav" : mime.includes("mp3") ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `audio.${ext}`);
  form.append("model", config.stt.model);
  if (config.stt.language) form.append("language", config.stt.language);

  const res = await fetch(config.stt.apiUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${config.stt.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`STT request failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
