# Teknisk spec — Claude Code för Huawei Watch Ultimate 2

Version 0.1 · Utforskningsfas · Målenhet: **Huawei Watch Ultimate 2 (HarmonyOS NEXT)**

---

## 1. Mål och avgränsning

**Mål:** Kunna logga in på Claude Code och styra det med rösten från klockan. Tala
en instruktion → Claude Code kör den i en riktig utvecklingsmiljö → resultatet
visas och/eller läses upp på klockan.

**Uttalat i scope för MVP:**
- Röststyrd inmatning av prompts från klockan.
- Text-svar tillbaka till klockan (streamat).
- Autentisering så att det är *din* Claude Code-session som styrs.

**Utanför scope för MVP (senare):**
- Full redigering av kod/diffar på klockan (skärmen är för liten).
- Godkännande av verktygskörningar med känsliga behörigheter direkt på klockan.
- Offline-läge.

---

## 2. Grundläggande insikt: tre exekveringsplan

Claude Code är en agent som behöver filsystem, git, node och verktyg. En klocka kan
inte köra det. Lösningen delar upp systemet i tre plan:

| Plan | Körs på | Ansvar |
|---|---|---|
| **Klient** | Huawei Watch (ArkTS-app) | Mic, UI, uppspelning, visa streamat svar |
| **Relä/Backend** | Molnserver eller Claude Code-fjärrmiljö | Kör Claude Code-sessionen, STT, håller WSS mot klockan |
| **Modell** | Anthropic API | Claude |

Inloggning sköts via ett **QR/device-flow** (OAuth 2.0 Device Authorization Grant,
RFC 8628): klockan visar en QR-kod, du loggar in i mobilens webbläsare, och klockan
hämtar en kortlivad token. **Ingen separat companion-app behövs** — se §6.

---

## 3. Plattformsförutsättningar (verifierat)

Watch Ultimate 2 tillhör klassen **Watch 4/5/Ultimate** som kör full HarmonyOS NEXT
med ArkTS/ArkUI — till skillnad från GT-serien som bara kör "lite-JS" och inte kan
installera riktiga tredjepartsappar.

Relevanta HarmonyOS-kit för det här projektet:

| Behov | Kit / API | Anteckning |
|---|---|---|
| Ljudinspelning | `@kit.AudioKit` (`AudioCapturer`) | PCM 16 kHz / 16-bit / mono |
| On-device STT | `@kit.CoreSpeechKit` (`speechRecognizer`) | **Endast mandarin offline — oanvändbart för svenska** |
| Nätverk | `@kit.NetworkKit` (WebSocket + HTTP) | Kräver `ohos.permission.INTERNET` |
| Mic-behörighet | Runtime permission | `ohos.permission.MICROPHONE`, dynamisk begäran + `checkAccessToken()` |
| UI | ArkUI (`ArcList` för runda skärmar) | Anpassat för klockans runda skärm |
| QR-generering | ArkUI (rita QR i UI) | För inloggning via device-flow (§6) |
| Signering/distribution | AppGallery Connect | Nyckel + CSR + certifikat + App ID |

**Konsekvens av STT-begränsningen:** eftersom on-device-transkribering bara stöder
mandarin måste svensk/engelsk röst→text ske i backend. Klockan spelar in ljud och
skickar PCM till backend, som kör en molnbaserad STT (t.ex. Whisper) med svenskt stöd.

---

## 4. Arkitektur

```
┌─────────────────────────┐      WSS (mTLS + token)      ┌───────────────────────────┐
│  Huawei Watch Ultimate 2 │◄────────────────────────────►│   Relä/Backend             │
│  ArkTS-app               │                               │                            │
│                          │   ── ljud (PCM-frames) ──►    │  1. STT (Whisper)          │
│  • Mic (AudioCapturer)   │                               │  2. Claude Code-session    │
│  • ArcList-UI            │   ◄── text-tokens (SSE-lik) ──│     (pty / SDK)            │
│  • TTS-uppläsning        │                               │  3. verktygs-status        │
│  • Sessionsstate         │   ◄── event: tool_use, done ──│                            │
└─────────────────────────┘                               └────────────┬──────────────┘
             │                                                          │ Anthropic API
   QR visas  │                                                          ▼
   på klockan▼                                                ┌───────────────────┐
┌─────────────────────────┐   ── skanna QR, logga in ──►      │   Claude           │
│  Din mobil (webbläsare)  │      på backend i mobilen        └───────────────────┘
│  vilken telefon som helst│      (device-flow, RFC 8628)
└─────────────────────────┘
```

### 4.1 Klient (klock-app, ArkTS)

- **Mic-knapp / "håll för att tala"** → startar `AudioCapturer`, strömmar PCM-frames
  över WebSocket.
- **Svarsvy** — ArcList som renderar streamad text token-för-token.
- **TTS** — läser upp svaret (kort sammanfattning; hela diffar visas som text).
- **Sessionsindikator** — visar när Claude Code kör verktyg ("kör tester…", "redigerar fil…").
- **Behörigheter** — begär `MICROPHONE` + `INTERNET` vid första start.

### 4.2 Relä/Backend

Kärnkomponenten. Ansvarar för:

1. **WSS-endpoint** mot klockan (autentiserad, se §6).
2. **STT-steg** — tar emot PCM, transkriberar till text.
3. **Claude Code-drivning** — håller en levande Claude Code-session per användare.
   Två möjliga sätt:
   - **Claude Agent SDK** (rekommenderat) — programmatisk styrning, strömmande svar,
     verktygs-events som strukturerad data.
   - **PTY-wrapping av CLI** — kör `claude` i en pseudo-terminal och parsar utdata.
     Enklare start men skörare parsning.
4. **Streaming tillbaka** — vidarebefordrar Claudes tokens och verktygs-events till klockan.
5. **Verktygsgodkännanden** — policy för vad som får köras utan mänskligt ja (se §7).

### 4.3 Inloggning via QR (ingen companion-app)

Klockan visar en QR-kod. Du skannar med mobilkameran, en webbläsare öppnas och du
loggar in på backend på mobilens stora skärm. Klockan pollar under tiden backend och
får till slut en kortlivad sessions-token. Detta är OAuth 2.0 Device Authorization
Grant (RFC 8628) — samma mönster som smart-TV- och CLI-inloggningar. Klockan lagrar
aldrig långlivade Anthropic-credentials, och ingen extra app behövs på telefonen.
Fullständigt flöde i §6.

---

## 5. Röst-pipeline i detalj

```
Tal → AudioCapturer (PCM 16k/16bit/mono)
    → WSS-frames till backend
    → STT (Whisper, svenska)  → text
    → Claude Code-session  → svar-tokens + verktygs-events
    → WSS tillbaka till klockan
    → (a) rendera text i ArcList
    → (b) TTS-uppläsning av sammanfattning
```

**Designval:**
- **Push-to-talk** framför "always listening" — sparar batteri och undviker falska triggers.
- **Endpointing i backend** — enklare än på klockan; backend avgör när användaren talat klart.
- **Kort TTS, full text** — läs upp en mening ("Klart, tre tester gröna"), visa
  detaljer som text. Undvik att läsa upp hela diffar.

---

## 6. Autentisering och säkerhet

**Problem:** man vill inte skriva lösenord/API-nyckel på en klockskärm, och klockan
ska inte hålla långlivade Anthropic-credentials.

**Lösning: QR/device-flow (OAuth 2.0 Device Authorization Grant, RFC 8628).**
Ingen companion-app — fungerar med vilken telefon som helst (iPhone eller Android),
eftersom det bara krävs kamera + webbläsare.

**Flöde:**

1. Klockan ber backend om en device-session → backend svarar med `device_code`,
   en `verification_uri` och en kort `user_code`.
2. Klockan visar en **QR-kod** som kodar `verification_uri` (med `user_code` inbakat).
   Fallback: visa bara `user_code` som text att skriva in på mobilen.
3. Du **skannar QR:en med mobilkameran** → webbläsaren öppnas → du loggar in på backend
   (OAuth mot din backend, inte direkt mot Anthropic) → backend binder `device_code`
   till ditt konto.
4. Klockan **pollar backend** (`device_code`) tills sessionen är godkänd, och får då en
   **kortlivad sessions-token** (t.ex. JWT, minuter–timmar).
5. Klockan använder token för att öppna **WSS mot backend** (gärna mTLS ovanpå).
6. Anthropic-API-nyckeln bor **bara i backend** — klockan ser den aldrig.

**Detaljer att få rätt:**
- Respektera device-flowets `interval` och `expires_in` (polla inte för tätt; låt koden
  löpa ut).
- QR på rund skärm: visa fullskärm med hög kontrast och tyst zon (quiet zone) runt om.

**Ytterligare härdning:**
- Rotera/förnya token; kort livslängd.
- Rate limiting per användare i backend.
- Logga vilka verktygskörningar som skett (audit).

---

## 7. Verktygsgodkännanden — den känsliga frågan

Claude Code kan köra kommandon, redigera filer och pusha kod. Röststyrt från en
klocka är det farligt att auto-godkänna allt.

**Föreslagen policy:**

| Åtgärd | Standard på klockan |
|---|---|
| Läsa filer, söka, köra tester | ✅ Auto-godkänn |
| Redigera filer | ⚠️ Tillåt, men visa vad som ändrades |
| `git push`, radera, nätverksanrop utåt | 🛑 Kräv explicit "ja" (röst eller knapp) |

Godkännande via röst behöver bekräftelsemönster ("Säg *bekräfta* för att pusha").
Överväg att låta känsliga godkännanden ske via en push-notis/länk till mobilen
(samma backend som inloggningen) istället för direkt på klockan.

---

## 8. MVP-plan (stegvis, testbar hela vägen)

Bygg nerifrån och upp så varje steg går att testa utan nästa.

**Steg 1 — Backend-kärna (ingen klocka)**
- Relä som tar emot text (inte ljud än) över WSS.
- Driver en Claude Code-session via Agent SDK.
- Streamar svar tillbaka.
- *Testas från* en enkel webb-/CLI-klient.

**Steg 2 — Röst i backend**
- Lägg till STT-steget: skicka en ljudfil → text → Claude Code.
- *Testas* genom att ladda upp en inspelad ljudfil.

**Steg 3 — Inloggning (QR/device-flow)**
- Backend-endpoints: skapa device-session, godkänn efter mobil-inloggning, polla token.
- Mobil inloggningssida (OAuth mot backend) + tokenutfärdande.
- *Testas* med QR i webbläsare innan klock-UI finns.

**Steg 4 — Klock-app (ArkTS)**
- Mic-knapp → PCM över WSS.
- ArcList som visar streamat svar.
- TTS-uppläsning.
- Signering via AppGallery Connect, sideload till din egen enhet för test.

**Steg 5 — Härdning**
- Verktygsgodkännanden, rate limiting, audit-logg, tokenrotation.

---

## 9. Öppna frågor / att verifiera

- [ ] **AudioKit på wearable** — bekräfta att `AudioCapturer` (mic) faktiskt är
  exponerat på Watch Ultimate 2, inte bara på telefon. (Kits finns på HarmonyOS NEXT,
  men wearable-profilen kan begränsa vissa API:er.)
- [ ] **WebSocket-stabilitet på klockan** — bakgrundskörning och reconnection när
  skärmen släcks (`BackgroundTasksKit`).
- [ ] **Latens** — tal→STT→Claude→svar bör kännas responsivt; mät end-to-end.
- [ ] **Distribution** — behöver du bara sideload till din egen klocka, eller
  AppGallery-publicering (kräver mer compliance)?
- [ ] **Backend-hosting** — egen server vs. använda en Claude Code-fjärrmiljö/SDK-host.
- [ ] **STT-leverantör** — Whisper (self-hosted vs. API) och svenskt kvalitetstest.

---

## 10. Teknikval — sammanfattning

| Lager | Val | Alternativ |
|---|---|---|
| Klock-app | ArkTS + ArkUI (ArcList) | — (enda vägen för native på HarmonyOS) |
| Inloggning | QR/device-flow (RFC 8628) | Companion-app (mer att bygga); API-nyckel på klockan (avrådes) |
| Transport | WebSocket (WSS) över NetworkKit | HTTP long-polling (sämre för streaming) |
| STT | Whisper (backend) | Molnleverantörs-STT med svenska |
| Claude Code-drivning | Claude Agent SDK | PTY-wrapping av CLI |
| TTS | On-device HarmonyOS TTS | Backend-TTS + ljudström |
| Auth-token | Kortlivad JWT från backend | Långlivad token (sämre säkerhet) |

---

## 11. Navigationsmodell i appen

Tre toppnivålägen som speglar Claudes tre ytor. Alla tre är **app-native** i vår
backend (se not nedan), var och en med en lista man navigerar i:

| Läge | Innehåll | Åtgärd |
|---|---|---|
| **Chats** | Vanliga Claude-samtal, utan repo | Öppna → återuppta; eller "Ny chatt" |
| **Projects** | Namngivna projekt med egen kontext/instruktioner | Öppna → fortsätt i projektets kontext (systemPrompt) |
| **Claude Code** | Kod-repos man jobbat i (kod-sessioner) | Öppna → återuppta kod-sessionen i repot (full verktygstillgång) |

**Not — datakälla:** Claude Code-historiken hämtas äkta via Agent SDK:s
`listSessions()` (grupperat per repo, återupptas med `resume`). Chats och Projects
som *claude.ai-konto-koncept* har inget publikt tredjeparts-API, så de är app-native
i den här backenden: Chats = fristående samtal i en neutral katalog, Projects =
kataloger med `project.json` (namn + instruktioner). De speglar Claudes struktur men
synkar inte med claude.ai.

**Två inmatningssätt, likvärdiga:**
- **Touch** — tryck på en rad/ruta för att välja, "‹" för tillbaka.
- **Digital Crown (övre kronan, upp till höger)** — snurra för att flytta markering
  (eller scrolla i chatt/fil), tryck för att välja. Nedre knappen = tillbaka.

På HarmonyOS binds detta till ArkUI:s kron-/rotationshändelser (`onDigitalCrown`) och
knapphändelser. I webb-demon (`backend/public/watch.html`) emuleras kronan med
mushjul (snurra) + klick på kron-elementet (tryck), plus piltangenter/Enter för
utveckling. Markerad rad visas med en fokusram.

Skärmflöde: para (QR) → samtycke → **hem** (tre lägen) → lista → chatt/fil.

---

## Referenser

- [Getting Started with HarmonyOS Wearable App Development](https://developer.huawei.com/consumer/en/multidevice/wearables/get-started/)
- [Wear Engine — Getting Started](https://developer.huawei.com/consumer/en/doc/connectivity-guides/dev-process-0000001051058039)
- [Audio-to-Text med HarmonyOS Core Speech Kit](https://dev.to/caojingcode/audio-to-text-implementation-with-harmonyos-ai-core-speech-kit-2fj3)
- [@ohos.multimedia.audio (Audio Kit) — ArkTS APIs](https://developer.huawei.com/consumer/en/doc/harmonyos-references/arkts-apis-audio)
- [Networking in HarmonyOS: HTTP och WebSocket](https://dev.to/handwer/networking-in-harmonyos-http-and-websocket-2h64)
- [Running & Debugging HarmonyOS Apps on Huawei Watches](https://dev.to/harmonyos/running-debugging-harmonyos-apps-on-huawei-watches-a-complete-setup-guide-for-developers-4903)
- [Home Assistant-klient för Huawei Watch (ArkTS + Wear Engine) — referensprojekt](https://github.com/gentslava/Home-Assistant-HarmonyOS-Next)
- [HarmonyOS Next application packaging and release](https://dev.to/liu_yang_fc0e605820ac220c/harmonyos-next-application-packaging-and-release-5h46)
