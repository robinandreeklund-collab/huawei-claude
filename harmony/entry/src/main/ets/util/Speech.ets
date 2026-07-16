import { speechRecognizer } from '@kit.CoreSpeechKit';
import { audio } from '@kit.AudioKit';
import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

// On-device speech-to-text. We capture 16 kHz mono PCM from the mic, stream it
// into Core Speech Kit's recognizer, and resolve with the final transcript. No
// audio ever leaves the watch — only the resulting text is sent as a prompt.
//
// NOTE: The exact Core Speech Kit + Audio Kit call shapes below should be
// confirmed against the API 12 SDK on a real Watch Ultimate 2 (see // verify on
// device markers). If speech is unavailable the caller falls back to text input.
export class Speech {
  private static engine: speechRecognizer.SpeechRecognitionEngine | null = null;
  private static capturer: audio.AudioCapturer | null = null;
  private static sessionId: string = 'claude-stt';

  /** Ask for the microphone permission at runtime. Returns whether it's granted. */
  static async ensureMic(ctx: common.UIAbilityContext): Promise<boolean> {
    try {
      const atm: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
      const perms: Permissions[] = ['ohos.permission.MICROPHONE'];
      const res: abilityAccessCtrl.PermissionRequestResult =
        await atm.requestPermissionsFromUser(ctx, perms);
      const grants: number[] = res.authResults;
      return grants.length > 0 && grants[0] === 0;
    } catch (e) {
      return false;
    }
  }

  /**
   * Transcribe a single utterance. Resolves with the recognised text (possibly
   * empty). Rejects if the mic/recognizer can't be brought up so the UI can fall
   * back to the keyboard sheet.
   */
  static async recognize(ctx: common.UIAbilityContext, lang: string): Promise<string> {
    const granted: boolean = await Speech.ensureMic(ctx);
    if (!granted) {
      throw new Error('mic_denied');
    }

    // Core Speech Kit STT supports zh-CN / en-US on current devices; Swedish is
    // not offered, so non-English locales fall back to en-US. // verify on device
    const locale: string = lang === 'english' ? 'en-US' : (lang === 'svenska' ? 'en-US' : 'en-US');

    return new Promise<string>((resolve, reject) => {
      let settled: boolean = false;
      let best: string = '';
      let timer: number = -1;

      const cleanup = (): void => {
        if (timer >= 0) {
          clearTimeout(timer);
          timer = -1;
        }
        Speech.teardown();
      };
      const done = (text: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(text.trim());
      };
      const fail = (msg: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new Error(msg));
      };

      const createParams: speechRecognizer.CreateEngineParams = {
        language: locale,
        online: 0 // 0 = on-device engine (keeps audio on the watch). // verify on device
      };

      speechRecognizer.createEngine(createParams)
        .then((engine: speechRecognizer.SpeechRecognitionEngine) => {
          Speech.engine = engine;

          const listener: speechRecognizer.RecognitionListener = {
            onStart(sessionId: string, eventMessage: string): void {
            },
            onEvent(sessionId: string, eventCode: number, eventMessage: string): void {
            },
            onResult(sessionId: string, result: speechRecognizer.SpeechRecognitionResult): void {
              if (result.result && result.result.length > 0) {
                best = result.result;
              }
              if (result.isLast) {
                done(best);
              }
            },
            onComplete(sessionId: string, eventMessage: string): void {
              done(best);
            },
            onError(sessionId: string, errorCode: number, errorMessage: string): void {
              fail('stt_error:' + errorCode);
            }
          };
          engine.setListener(listener);

          const audioInfo: speechRecognizer.AudioInfo = {
            audioType: 'pcm',
            sampleRate: 16000,
            soundChannel: 1,
            sampleBit: 16
          };
          const startParams: speechRecognizer.StartParams = {
            sessionId: Speech.sessionId,
            audioInfo: audioInfo
          };
          engine.startListening(startParams);

          // Feed mic PCM into the recognizer until VAD end (onResult isLast) or
          // the safety timeout below.
          return Speech.startCapture((buf: ArrayBuffer) => {
            const e: speechRecognizer.SpeechRecognitionEngine | null = Speech.engine;
            if (e !== null) {
              e.writeAudio(Speech.sessionId, new Uint8Array(buf));
            }
          });
        })
        .then(() => {
          // Stop listening after ~9s regardless, so we never hold the mic open.
          timer = setTimeout(() => {
            const e: speechRecognizer.SpeechRecognitionEngine | null = Speech.engine;
            if (e !== null && !settled) {
              try {
                e.finish(Speech.sessionId); // flush -> onComplete/onResult isLast
              } catch (err) {
                done(best);
              }
            }
          }, 9000);
        })
        .catch((e: BusinessError) => {
          fail('stt_start_failed:' + (e ? e.code : -1));
        });
    });
  }

  private static async startCapture(onData: (buf: ArrayBuffer) => void): Promise<void> {
    const options: audio.AudioCapturerOptions = {
      streamInfo: {
        samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
        channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
        encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
      },
      capturerInfo: {
        source: audio.SourceType.SOURCE_TYPE_MIC,
        capturerFlags: 0
      }
    };
    const capturer: audio.AudioCapturer = await audio.createAudioCapturer(options);
    Speech.capturer = capturer;
    capturer.on('readData', (buffer: ArrayBuffer) => {
      onData(buffer);
    });
    await capturer.start();
  }

  private static teardown(): void {
    const cap: audio.AudioCapturer | null = Speech.capturer;
    if (cap !== null) {
      try {
        cap.stop();
        cap.release();
      } catch (e) {
        // ignore
      }
      Speech.capturer = null;
    }
    const eng: speechRecognizer.SpeechRecognitionEngine | null = Speech.engine;
    if (eng !== null) {
      try {
        eng.cancel(Speech.sessionId);
        eng.shutdown();
      } catch (e) {
        // ignore
      }
      Speech.engine = null;
    }
  }
}
