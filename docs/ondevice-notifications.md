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
