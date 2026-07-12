# Aviseringar & haptik på klockan (ArkTS) — redo att koppla in

Backend-sidan är **byggd och verifierad** (push-token-registrering, persistent
session som överlever nedkoppling, Push Kit-klient, hook som pushar när Claude
blir klar i bakgrunden). Det som återstår ligger **på klockan** (ArkTS) och byggs
i fas 4. Nedan är den färdiga koden/mönstret klockappen använder — verifiera de
exakta API-signaturerna mot DevEco Studio på en riktig Watch Ultimate 2.

Ansvarsfördelning:

| Del | Var | Status |
|---|---|---|
| Push-token-registrering (`register_push`) | Backend ✅ + klocka | Backend klar; klocka nedan |
| Persistent session + buffert + push-hook | Backend ✅ | Klar, verifierad |
| Huawei Push Kit send-API | Backend ✅ | Klar, gated på creds |
| Ta emot push → visa avisering | Klocka (OS + app) | Kod nedan |
| Haptik/vibration | Klocka (Vibrator Kit) | Kod nedan |
| Lokal avisering i förgrund | Klocka (Notification Kit) | Kod nedan |
| Förgrund/bakgrund-signal (`background`/`foreground`) | Klocka | Kod nedan |
| Röstinmatning (tal → text) | Klocka (Core Speech Kit / ASR) | Kod nedan — transkriberas **på enheten**, inget ljud till backend |

---

## 1. Hämta push-token och registrera hos backend

Vid appstart: hämta enhetens Push Kit-token och skicka den över WSS med
`register_push`. Backend lagrar den per användare och pushar dit när Claude blir
klar medan appen är i bakgrunden.

```ts
import { pushService } from '@kit.PushKit';

async function registerPush(ws: WebSocket) {
  try {
    const pushToken = await pushService.getToken();
    ws.send(JSON.stringify({ type: 'register_push', pushToken }));
  } catch (e) {
    console.error('push token failed', e);
  }
}
```

## 2. Signalera förgrund/bakgrund

Så vet backend om den ska leverera live (förgrund) eller pusha (bakgrund).
Koppla till abilityns livscykel (`UIAbility.onForeground` / `onBackground`).

```ts
// I din UIAbility:
onForeground() { ws?.send(JSON.stringify({ type: 'foreground' })); }
onBackground() { ws?.send(JSON.stringify({ type: 'background' })); }
```

## 3. Ta emot push (bakgrund)

För **notification-meddelanden** visar HarmonyOS aviseringen automatiskt (med
systemets vibration). Vid tryck djuplänkas till appen — läs `data` (som backend
skickar med, t.ex. `{ token, context }`) och öppna rätt chatt.

```ts
// Deep-link: läs data-payloaden när appen öppnas från en avisering.
import { Want } from '@kit.AbilityKit';

onNewWant(want: Want) {
  const data = want.parameters?.['data'];      // JSON-strängen backend skickade
  if (data) {
    const { context } = JSON.parse(String(data));
    openChatFor(context);                       // återanslut WSS + öppna chatten
  }
}
```

## 4. Haptik (Vibrator Kit)

Vibrera när ett svar kommer i förgrunden, eller som extra feedback.

```ts
import { vibrator } from '@kit.SensorServiceKit';

function buzz() {
  vibrator.startVibration(
    { type: 'time', duration: 200 },
    { id: 0, usage: 'notification' },
  ).catch((e) => console.error('vibrate failed', e));
}
```

Mönster (två pulser) för "klart":

```ts
async function buzzDone() {
  await vibrator.startVibration({ type: 'preset', effectId: 'haptic.notice.success', count: 1 },
    { usage: 'notification' }).catch(() => {});
}
```

### Haptik när splashen släpper (appstart)

Klockans laddnings-splash (Claude-sparken + ring-svep) avslutas med en mjuk
dubbel-tap så starten känns i handleden — samma ögonblick som webb-demon kör
`navigator.vibrate([18,40,24])`. På enheten görs det med Vibrator Kit:

```ts
// Anropa när splash-animationen är klar och parningsvyn visas.
async function buzzStart() {
  await vibrator.startVibration(
    { type: 'time', duration: 18 },
    { id: 0, usage: 'notification' },
  ).catch(() => {});
  await vibrator.startVibration(
    { type: 'time', duration: 24 },
    { id: 0, usage: 'notification' },
  ).catch(() => {});   // andra pulsen ~40 ms efter den första
}
```

> Webb-demon (`public/watch.html`) använder `navigator.vibrate` som platshållare
> (no-op på desktop). En riktig dubbelpuls kan även göras med ett anpassat
> `type: 'time'`-mönster eller en preset-effekt (`haptic.notice.light`) på enheten.
> Samma `buzz()` triggas också vid `turn_done` (när Claude svarat klart).

## 5. Lokal avisering i förgrunden (Notification Kit)

När appen körs men användaren är på en annan skärm i appen.

```ts
import { notificationManager } from '@kit.NotificationKit';

function localNotify(title: string, body: string) {
  notificationManager.publish({
    id: 1,
    content: {
      notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
      normal: { title, text: body },
    },
  }).catch((e) => console.error('notify failed', e));
}
```

## 6. Röstinmatning på klockan (Core Speech Kit / ASR)

Claude-**modellen** tar bara emot text (Agent SDK / Messages-API stödjer text,
bilder, PDF — **inte ljud**). Röstläget i Claude-apparna är ett separat
tal-till-text-lager framför modellen. Så för att "prata med Claude" måste tal
transkriberas till text först — och det ska ske **på klockan**, så att inget
ljud går via vår backend.

På enheten görs det med HarmonyOS Core Speech Kit (on-device ASR): tryck-och-håll
mikrofonen, transkribera lokalt, skicka bara den färdiga texten över WSS som en
vanlig `prompt`. Ingen `audio_start`/`audio_chunk`/`audio_end` behövs.

```ts
import { speechRecognizer } from '@kit.CoreSpeechKit';

let asr: speechRecognizer.SpeechRecognitionEngine | null = null;

async function initAsr() {
  asr = await speechRecognizer.createEngine({
    language: langIsSwedish() ? 'zh-CN' : 'en-US', // välj stödd locale; verifiera på enhet
    online: 0,                                     // 0 = on-device (inget moln)
  });
  asr.setListener({
    onResult: (_id, res) => {
      const text = String(res?.result ?? '').trim();
      if (res?.isLast && text) {
        ws?.send(JSON.stringify({ type: 'prompt', text })); // bara text — inget ljud
      }
    },
    onError: (_id, code) => console.error('asr error', code),
    onComplete: () => { /* mic-knappen tillbaka till vila */ },
  });
}

// Tryck-och-håll: starta vid nedtryck, stoppa vid släpp.
function startListening() {
  asr?.startListening({ sessionId: 'watch', audioInfo: { audioType: 'pcm', sampleRate: 16000, soundChannel: 1, sampleBit: 16 } });
}
function stopListening() { asr?.finish('watch'); }
```

Behörighet krävs: `ohos.permission.MICROPHONE` (fråga användaren vid första
röstanvändning). Verifiera exakta signaturer och stödda locales mot DevEco Studio
på Watch Ultimate 2 — API:t kan skilja mellan HarmonyOS-versioner.

> **Webb-demon** (`public/watch.html`) gör motsvarande i webview:n med
> `SpeechRecognition`/`webkitSpeechRecognition` (`wireOnDeviceVoice`): transkriberar
> i webbläsaren och skickar bara texten, med server-STT (`audio_*`) som reserv om
> webview:n saknar taligenkänning. På den riktiga klockan ersätts det av Core
> Speech Kit ovan så allt sker helt på enheten.

---

## Fullt flöde

```
Du: "fixa bug X"  →  sänker armen (appen → bakgrund → skickar {type:"background"})
        │
Backend kör Claude Code (minuter). Socket får dö — sessionen lever kvar.
        │  vid turn_done, appen ej i förgrund
Backend → Huawei Push Kit → klockan
        │
HarmonyOS visar avisering + vibrerar (systemet). Data: { context }
        │  tryck
Appen öppnas → onNewWant läser context → återansluter WSS (auth) →
attach() flushar buffrade svar → chatten visar Claudes svar
```

## Att verifiera på enhet (fas 4)
- [ ] Push Kit-token på Watch Ultimate 2 (AGC-app konfigurerad, Push aktiverat).
- [ ] Exakt push-payload-format för HarmonyOS (fält i `pushkit.ts` kan behöva justeras).
- [ ] Behörigheter: aviseringar (`ohos.permission.NOTIFICATION_CONTROLLER` m.fl.) och
      att användaren godkänner aviseringar vid första start.
- [ ] Vibrator-behörighet (`ohos.permission.VIBRATE`).
