# Utredning: lansera appen på Google Play för Android-klockor (Wear OS / Samsung)

**Kort svar: Ja, det går — och billigare än man tror, eftersom vår backend redan
är plattformsoberoende.** Klockan är en tunn WebSocket-klient mot vår Node/TS-backend
(som kör Claude via Agent SDK). HarmonyOS-appen och en Wear OS-app är *båda* bara
olika skal runt samma backend och samma WSS-protokoll. Att lägga till Wear OS
betyder alltså: **skriv ett till tunt klientskal — noll ändring i backend, login
eller Claude-integration.**

Rekommendation: **native Wear OS-klient i Kotlin + Compose for Wear OS** (bästa UX
och krav-passning för Google Play), med webbdemons `watch.html` som exakt
design-referens. En WebView-wrapper är möjlig som genväg men är en dålig idé för
en publik Play-lansering (se nedan).

---

## 1. Plattformslandskapet (2026)

| Sak | Läge |
|---|---|
| **Samsung Galaxy Watch** | Galaxy Watch 4 och senare (Watch 5/6/7/8, FE, Ultra) kör **Wear OS** ("One UI Watch" ovanpå Wear OS). Gamla Tizen-klockor (Watch 3, Active/Active 2, Gear) är **utfasade** — Galaxy Store stängde Tizen-innehåll 30 sep 2025. Att "sikta på Samsung" = att sikta på Wear OS. |
| **Övriga Android-klockor** | Google Pixel Watch, samt Wear OS-klockor från Fossil, Mobvoi (TicWatch), OnePlus m.fl. Samma app, samma Play-distribution. |
| **Distribution** | Google Play Console. Engångsavgift 25 USD för utvecklarkonto. Publiceras som **AAB** (Android App Bundle). |
| **Målversion (target SDK)** | Idag minst **Android 14 (API 34)**; från **31 aug 2026** krävs **Android 15 (API 35)** för Wear OS-uppdateringar. |
| **64-bitars** | Från **15 sep 2026** måste alla Wear OS-appar stödja 64-bit (standard i Kotlin/Compose). |
| **Testmål** | Wear OS 3.0+ (Wear OS 5 = Android 14). |

Källor längst ner.

---

## 2. Passar vår arkitektur? — Ja, nästan gratis på backend-sidan

```
        HarmonyOS-app (ArkTS)  ─┐
        Wear OS-app (Kotlin)   ─┼──►  samma WSS-protokoll  ──►  vår Node/TS-backend  ──►  Claude Agent SDK
        Webbdemon (watch.html) ─┘        (auth, prompt, stream, watch-tools …)         (prenumeration via token)
```

Det som **redan är klart och återanvänds oförändrat**:
- Hela backend (Render), Claude Agent SDK-integration, streaming, watch-verktyg.
- **Inloggningsflödet**: device-flow QR → telefon → `/connect` (klistra in `sk-ant`-token).
  Fungerar identiskt från en Wear OS-app — token bor kvar på backenden, aldrig på klockan.
- WSS-meddelandeprotokollet (`auth`, `prompt`, `stream_delta`, `needs_confirmation`,
  `watch_action`, `list`, `settings` osv.).

Det som **måste byggas nytt** = klientskalet (ca motsvarande dagens ~1000 raders
`watch.html`, men i Compose). Ingen ny serverkod.

En extra bonus: en av Google Plays Wear-kvalitetskrav (**WO-P6**) är att appen **inte
får be om användarnamn/lösenord direkt på klockan**. Vårt QR-till-telefon-login
uppfyller detta **redan by design** — vi skriver aldrig in lösenord på klockan.

---

## 3. Två vägar att bygga klienten

### Väg A — Native Compose for Wear OS (rekommenderas)
Kotlin + `androidx.wear.compose` (Material 3 Expressive). Pratar med backend via en
WebSocket (OkHttp/Ktor). Renderar chatt, listor, bekräftelsekort, timer/notiser precis
som webbdemon men med native prestanda och rundskärms-komponenter.

- **För:** Bäst UX (native scroll, roterande krona, haptik, alltid-på-skärm), klarar
  alla Play-kvalitetskrav, snabb och batterisnål, framtidssäker.
- **Emot:** Ny kodbas i Kotlin (delar inget med ArkTS-appen förutom protokollet).
- **Design:** `watch.html` blir pixel-referens — clay `#D97757`, varm charcoal,
  serif-rubriker, rundskärms-layout återskapas 1:1 i Compose-teman.

### Väg B — WebView-wrapper runt `watch.html` (genväg, ej för publik lansering)
En minimal Wear OS-app som laddar vår befintliga `watch.html` i en WebView.

- **För:** Återanvänder GUI:t vi redan byggt nästan direkt. Snabbast till en
  sideloadad prototyp.
- **Emot / risker:**
  - WebView finns på moderna Wear OS men **garanteras inte på alla OEM-byggen** och
    är **avrådd** för Wear av prestanda-/UX-skäl (klock-CPU, batteriet, rundskärm).
  - Googles skärpta **WebView-policy 2026** (minsta-funktionalitet) gör att en tunn
    "webbsida-i-app" kan **nekas vid granskning**.
  - Sämre integration med krona, haptik och alltid-på-skärm.
  - **Slutsats:** OK för intern test/sideload, olämpligt som Play-produkt.

| | Väg A (Compose) | Väg B (WebView) |
|---|---|---|
| Play-lansering | ✅ Klarar kraven | ⚠️ Risk att nekas (WebView-policy) |
| Prestanda/batteri | ✅ Native | ❌ Tungt på klock-hårdvara |
| Återanvänder `watch.html` | Som designreferens | Nästan direkt |
| Krona/haptik/alltid-på | ✅ Fullt | ❌ Begränsat |
| Arbetsinsats | Medel (ny Kotlin-klient) | Låg (wrapper) |

---

## 4. Google Play-checklista (Wear OS)

- [ ] Utvecklarkonto (25 USD), Play Console.
- [ ] **AAB** som targetar **API 34** (idag) → **API 35 senast 31 aug 2026**; 64-bit senast 15 sep 2026.
- [ ] **Fristående app** (WO-P5): vår app är fristående — den pratar direkt med backend
      över WiFi/LTE. Telefonen används bara för QR/`/connect` (en webbsida, ingen
      Android-följeslagarapp krävs).
- [ ] **Ingen lösenordsinmatning på klockan** (WO-P6): uppfyllt via QR-login. ✅
- [ ] **Rundskärm** (WO-V16): innehåll inom synlig yta, inget kapas — vi har redan
      round-safe layout att utgå från.
- [ ] **Svart bakgrund** (WO-V13), **touch-mål ≥ 48dp** (WO-V2), **swipe-to-dismiss
      bakåtnavigering** (WO-V3), respektera användarens fontstorlek (WO-V1).
- [ ] **Butiksbilder** i 1:1 för Wear, minst en Wear-skärmbild (WO-G5/G6).
- [ ] Om vi har både en telefon- och klockapp: samma paketnamn + signeringsnyckel (WO-G7).
      (Vi har ingen Android-telefonapp, så detta är N/A.)

---

## 5. Policy: prenumerationen (samma sak som tidigare)

Google Play ändrar inte token-frågan. Appen är bara en **klient**; Claude-autentiseringen
sker på backenden via `claude setup-token` (användarens Pro/Max). Två modeller:

- **BYO-backend (bäst för publik Play):** varje användare kör sin egen backend och
  ansluter sin egen token. Då är appen bara ett gränssnitt — inga tredjeparts-ToS-problem.
- **En delad backend för alla på våra tokens:** samma begränsning som vi redan
  dokumenterat — Anthropics konsument-ToS tillåter inte att en tredjepartsprodukt kör
  många användare på prenumerations-OAuth. Undvik för publik lansering.

Med andra ord: Play-lansering är fullt möjlig med BYO-backend-modellen, precis som på
HarmonyOS.

---

## 6. Arbetsinsats (grov uppskattning, väg A)

| Del | Insats |
|---|---|
| Projektuppsättning (Compose for Wear OS, tema/palett) | Liten |
| WSS-klient + protokoll (återanvänder befintligt meddelandeschema) | Liten–medel |
| Skärmar: splash, pairing/connect (QR), hem, listor, chatt+streaming, bekräftelsekort, inställningar | Medel |
| Wear-finish: krona-scroll, haptik (Vibrator), alltid-på, swipe-back, notiser | Medel |
| Play-paketering, butiksbilder, granskning | Liten |

Backend: **0** (oförändrad). Ingen ny serverkod, ingen ny login, ingen ny Claude-kod.

---

## 7. Rekommendation

1. **Bygg väg A (Compose for Wear OS)** som Wear OS-klient — samma backend, samma
   QR-login, `watch.html` som designreferens. Det ger en riktig Play-lansering för
   Samsung Galaxy Watch (4+) och alla andra Wear OS-klockor.
2. Använd **BYO-backend-modellen** för publik distribution (kringgår ToS-frågan).
3. Väg B (WebView) endast om vi snabbt vill sideloada en prototyp på en Galaxy Watch
   för känsla — inte som slutprodukt.

Nästa konkreta steg om du vill gå vidare: sätta upp ett Compose for Wear OS-skelett med
vårt tema (clay/charcoal/serif) och koppla WSS-`auth`+`prompt`+`stream` mot den befintliga
backenden, så vi ser en första chatt på en Wear OS-emulator.

---

## Källor
- Compose for Wear OS — https://developer.android.com/training/wearables/compose
- Wear OS app quality (WO-krav) — https://developer.android.com/docs/quality-guidelines/wear-app-quality
- Paketera & distribuera Wear OS-appar — https://developer.android.com/training/wearables/packaging
- Target API level-krav (Play) — https://support.google.com/googleplay/android-developer/answer/11926878
- Building experiences for Wear OS (Android Developers Blog, 2025) — https://android-developers.googleblog.com/2025/08/building-experiences-for-wear-os.html
- Samsung avvecklar Tizen-klockor (30 sep 2025) — https://www.sammobile.com/news/own-tizen-galaxy-watch-here-what-happens-after-september-30/
- Wear OS (översikt, vilka klockor) — https://en.wikipedia.org/wiki/Wear_OS
- Google Play WebView-policy 2026 — https://blog.webvify.app/blogs/google-play-store-policy-update-2026-webview-guide/
- Web/WebView på Wear OS (begränsningar) — https://dev.to/okoye_ndidiamaka_5e3b7d30/the-web-on-your-wrist-building-great-apps-for-smartwatches-and-wearables-o8j
