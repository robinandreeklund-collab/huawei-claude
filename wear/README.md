# Claude — Wear OS-app (Samsung Galaxy Watch m.fl.)

Native Wear OS-klient (Kotlin + Compose for Wear OS) mot **samma relay-backend**
som HarmonyOS-appen och webbdemon. Klockan är ett tunt skal: den kör QR-login,
öppnar en WebSocket och renderar exakt samma protokoll — all Claude-logik ligger
kvar på backenden. Fungerar på Galaxy Watch 4 och senare samt alla andra Wear
OS-klockor (Pixel Watch, TicWatch …).

## Öppna & köra

1. Öppna mappen `wear/` i **Android Studio** (Hedgehog eller nyare). Låt den synka
   Gradle — den hämtar Compose for Wear OS, OkHttp osv. automatiskt.
2. Sätt din backend-URL (Render). Antingen:
   - bygg med `-PbaseUrl=https://din-app.onrender.com`, eller
   - lämna default och ändra den på klockan: på **Pair**-skärmen finns en
     `⚙ <host>`-knapp där du klistrar in URL:en (sparas lokalt).
   Default är `https://huawei-claude-backend.onrender.com`.
3. Para ihop din Galaxy Watch med datorn (Wireless debugging i klockans
   utvecklarläge) och kör appen från Android Studio, **eller** kör på en
   Wear OS-emulator (Wear OS Large Round, API 34).

## Flöde (identiskt med de andra klienterna)

```
Splash → Pair (QR)  → [telefon: skanna + godkänn]  → Consent
      → Connect Claude (QR → /connect, klistra in token på telefonen)
      → Home (Chats / Projects / Claude Code) → lista → Chat (streaming) → Settings
```

- **Login:** device-flow. Klockan visar en QR (backendens `qr_data_url`), telefonen
  skannar och godkänner. Ingen lösenordsinmatning på klockan (uppfyller Google
  Plays Wear-krav WO-P6).
- **Röst:** on-device taligenkänning (`RecognizerIntent`) — bara texten skickas,
  inget ljud till backenden.
- **Text:** on-watch-tangentbord/handskrift via `RemoteInput`.
- **Streaming:** Claudes svar byggs ord för ord med en clay-caret.
- **Bekräftelser:** farliga verktyg kräver Allow/Deny på klockan.
- **Watch-verktyg:** `vibrate`/`notify`/`timer` och sensor-frågor besvaras (health/
  location är stubbade som i webbdemon — riktiga sensorer är en TODO).

## Publicera på Google Play

Se `../docs/wear-os-utredning.md` för checklistan (target-API, 64-bit, rundskärm,
butiksbilder 1:1, fristående app, prenumerations-policy/BYO-backend).

## Struktur

| Fil | Roll |
|---|---|
| `WatchViewModel.kt` | All state + WSS-protokoll + device-flow + watch-verktyg |
| `net/Api.kt`, `net/WsClient.kt` | HTTP (device-flow/connect) och WebSocket |
| `MainActivity.kt` | Röst/tangentbord/server-URL-input, host för Compose |
| `ui/App.kt` | Navigation (route-state) + banners |
| `ui/screens/*` | Splash, Pairing, ConnectClaude, Consent, Home, List, Chat, Settings |
| `ui/theme/Theme.kt` | Claude-paletten (clay/charcoal/serif) |

Backend: **oförändrad**. Ingen serverkod, login eller Claude-integration behövde
ändras för att lägga till Wear OS.
