# Claude — HarmonyOS-app (Huawei Watch Ultimate 2)

Native HarmonyOS NEXT-klient (ArkTS, Stage-modell, API 12) mot **samma
relay-backend** som Wear OS-appen och webbdemon. Klockan är ett tunt skal: den
kör QR-inloggning (device flow), öppnar en WebSocket och renderar exakt samma
protokoll — all Claude-logik ligger kvar på backenden. Ingen serverkod ändrades
för att lägga till den här tredje klienten.

- `bundleName`: `com.claude.watch`
- `deviceTypes`: `["wearable"]`
- Mål: HarmonyOS NEXT / API 12 (`compatibleSdkVersion "5.0.0(12)"`)

## Öppna & köra i DevEco Studio

1. Öppna mappen `harmony/` i **DevEco Studio** (NEXT/5.0 eller nyare). Låt den
   köra **File → Sync and Refresh Project** — då genereras `local.properties`,
   `hvigor-wrapper`, `oh_modules/` osv. automatiskt.
2. Kontrollera SDK: **Settings → HarmonyOS SDK** ska ha API 12 (HarmonyOS NEXT)
   installerat. Om din Watch Ultimate 2 kör en annan API-nivå — justera
   `compatibleSdkVersion` i `build-profile.json5` och `deviceTypes` vid behov
   (se *Varningar* nedan).
3. Sätt backend-URL. Standard är
   `https://huawei-claude-backend-uzd9.onrender.com`. Två sätt att ändra:
   - **på klockan**: både **Pair**-skärmen (`⚙ <host>`) och
     **Settings → Server** öppnar ett litet textfält där du klistrar in URL:en.
     Den sparas lokalt (`preferences`, store `claude`, nyckel `base`) och
     appen parar om direkt mot den nya backenden.
   - **i koden**: ändra `DEFAULT_BASE` i
     `entry/src/main/ets/net/Config.ets`.
4. Kör på en riktig klocka (rekommenderas — sensorer, haptik och tal finns bara
   där) eller på **Previewer/Emulator** för wearable.

## Signering för debug (AppGallery Connect)

HarmonyOS kräver signering även för debug-bygge på fysisk enhet.

1. Registrera ett projekt/app i **AppGallery Connect** med paket-ID
   `com.claude.watch`.
2. **Registrera klockans UDID** som testenhet: i DevEco **Device Manager**, eller
   AGC → *Users and permissions → Devices*. Utan registrerad UDID nekas
   debug-installationen.
3. I DevEco: **File → Project Structure → Signing Configs → Automatically
   generate signature** (Bearer-inloggad Huawei-ID). `signingConfigs` lämnas
   medvetet tomt i `build-profile.json5` så att auto-signeringen tar över.

## Push Kit

`entry/src/main/ets/util/Push.ets` hämtar en push-token *best effort* och skickar
`register_push{pushToken}` efter `auth`. För att det ska fungera:

1. Aktivera **Push Kit** för appen i AppGallery Connect.
2. Lägg `agconnect-services.json` i `entry/` (DevEco lägger den rätt vid
   *Sync*).
3. Lägg **App ID/Secret** i backendens miljö (samma variabler som Wear-flödet
   använder) så att relayn kan pusha. Backenden är oförändrad — den kan redan ta
   emot `register_push`.

Misslyckas token-hämtningen (t.ex. Push ej aktiverat) sväljs felet och flödet
fortsätter — push är valfritt.

## Flöde (identiskt med de andra klienterna)

```
Splash → Pair (QR)  → [telefon: skanna + godkänn]  → Consent
      → Connect Claude (QR → /connect, klistra in token på telefonen)
      → Home (Chats / Projects / Claude Code) → lista → Chat (streaming) → Settings
```

- **Login:** device flow. Klockan visar en QR (backendens `qr_data_url`),
  telefonen skannar och godkänner. Ingen lösenordsinmatning på klockan.
- **Röst:** on-device taligenkänning via **Core Speech Kit** (`speechRecognizer`)
  matad med PCM från **Audio Kit** (`AudioCapturer`). Bara texten skickas som
  `prompt` — inget ljud lämnar klockan. Nekas mikrofonen faller UI:t tillbaka på
  tangentbords-arket.
- **Text:** `TextInput`-ark för Type-knappen.
- **Streaming:** Claudes svar byggs ord för ord med en clay-caret (`▍`).
- **Bekräftelser:** farliga verktyg kräver Allow/Deny på klockan
  (`needs_confirmation` → `confirm{id,allow}`).
- **Watch-verktyg:** `watch_action` (`vibrate`/`notify`/`timer`) och `watch_query`
  (health/location) besvaras precis som i webbdemon (sensordata är stubbad —
  riktiga sensorer via Health Kit är en framtida TODO).

## Design

Claude-paletten (clay `#D97757`, charcoal-bakgrund, serif-rubriker) ligger i
`entry/src/main/ets/model/Theme.ets` och `resources/base/element/color.json`.
Layouten är rund-säker: innehållet är centrerat och scrollbart så inget klipps
vid kanterna på den runda skärmen.

## Struktur

| Fil | Roll |
|---|---|
| `entry/src/main/ets/net/Net.ets` | All state + WSS-protokoll + device flow + watch-verktyg (motsvarar `WatchViewModel.kt`) |
| `entry/src/main/ets/net/Http.ets`, `Ws.ets` | HTTP (device flow/connect/meta) och WebSocket |
| `entry/src/main/ets/net/Config.ets` | Backend-URL (default + `preferences`-override) |
| `entry/src/main/ets/model/Types.ets` | `ChatMsg`, `ListItem`, `Scope`, routes m.m. |
| `entry/src/main/ets/model/Theme.ets` | Claude-paletten + spark-path |
| `entry/src/main/ets/util/` | `Json` (typade parsers), `Qr`, `Haptics`, `Speech`, `Push` |
| `entry/src/main/ets/pages/Index.ets` | Router (route-state), banners, error-toast, input-ark |
| `entry/src/main/ets/components/*` | Splash, Pairing, Connect, Consent, Home, List, Chat, Settings |
| `entry/src/main/ets/entryability/EntryAbility.ets` | Ability, laddar Index, back-gest, foreground/background |

## Varningar (måste verifieras i DevEco / på enheten)

- **Kan inte kompileras i den här miljön.** Koden är skriven så korrekt och
  idiomatiskt som möjligt för HarmonyOS NEXT API 12, men **en DevEco
  *Sync* + *Build* krävs** för att fånga eventuella SDK-signaturskillnader.
- **API-nivå & `deviceTypes`.** Bekräfta att Watch Ultimate 2 verkligen kör
  API 12 och att `"wearable"` är rätt device-typ för just din enhet; justera
  annars `build-profile.json5` / `module.json5`.
- **Core Speech Kit.** `speechRecognizer`-anropen (`createEngine`,
  `startListening`, `writeAudio`, `finish`) och `AudioCapturer`-pipen är märkta
  `// verify on device` i `util/Speech.ets`. Tillgänglighet och exakt
  parameter­form (särskilt `online: 0` för offline-motorn och stödda språk —
  `en-US`/`zh-CN`; svenska saknas och faller tillbaka på engelska) kan skilja
  mellan enheter. Faller det, används textinmatning.
- **Push Kit.** `pushService.getToken()` kräver AGC-konfiguration; utan den
  returneras tom token och `register_push` skickas inte.
- **App-ikon.** Ikonen levereras som SVG-spark
  (`AppScope/resources/base/media/app_icon.svg`). DevEco vill ofta ha en
  *layered*/PNG-ikon — regenerera via **New → Image Asset** om buildern klagar.
- **Serif-typsnitt.** Rubrikerna använder `fontFamily('serif')`; om systemet
  inte har en serif-fallback kan du bädda in ett eget typsnitt under
  `resources/base/media` och registrera det.

Backend: **oförändrad**. Ingen serverkod, login eller Claude-integration behövde
ändras för att lägga till HarmonyOS-klienten.
