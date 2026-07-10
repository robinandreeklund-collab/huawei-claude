# Relay-backend (fas 1 + 3)

Körbar prototyp som **driver Claude Code via Claude Agent SDK** och exponerar det
över WebSocket, med **QR-inloggning** (OAuth device-flow, RFC 8628). Testas i
webbläsaren idag — ingen klocka behövs ännu.

```
[Browser/klocka] --QR device-flow--> [denna backend] --Claude Agent SDK--> [Claude Code]
                 <----- WSS stream -----                <----- svar -----
```

## Vad som ingår

| Del | Fil | Status |
|---|---|---|
| Device-flow (kod → godkänn → token) | `src/auth.ts` | ✅ verifierat |
| HTTP + WSS-server (en port, Cloud Run-vänlig) | `src/server.ts` | ✅ |
| Claude Code-drivning (streamande, multi-turn) | `src/claude-session.ts` | ✅ verifierat |
| Mobilens inloggningssida | `public/login.html` | ✅ |
| Browser-testklient (QR → prompt → svar) | `public/test-client.html` | ✅ |
| **Round-watch GUI-demo** (QR → samtycke → röst/text → svar) | `public/watch.html` | ✅ verifierat |
| Verktygsgrind (blockerar `git push` m.m.) | `src/claude-session.ts` | ✅ (prototypnivå, spec §7) |
| **Demo-/sandbox-läge** (isolerat repo, budget-tak, rate limit) | `src/config.ts` + `src/server.ts` | ✅ verifierat |
| **Innehållsmoderering** (filter-hook på svar) | `src/moderation.ts` | ✅ (pluggbar, compliance R1) |
| **Samtycke + kontoradering + rapport** | `src/auth.ts` + `src/server.ts` | ✅ verifierat (compliance R1/R4) |
| **Röst / STT** (ljud → text → prompt) | `src/stt.ts` | ✅ pipeline verifierad; kräver STT-nyckel |
| **Persistent session** (överlever nedkoppling, buffrar, återkopplar) | `src/user-session.ts` | ✅ verifierad |
| **Push Kit + bakgrundsnotis** (buzz när Claude blir klar) | `src/pushkit.ts` | ✅ verifierad; kräver Push-creds. Klock-sida: `../docs/ondevice-notifications.md` |

## Kör lokalt

```bash
cd backend
npm install
npm run build && npm start      # eller: npm run dev
```

Autentisering mot Anthropic: Claude Agent SDK plockar upp `ANTHROPIC_API_KEY`
eller en `claude`-inloggning från miljön. Sätt `ANTHROPIC_API_KEY` innan start
om ingen finns.

Två klienter:
- **http://localhost:8080/** — enkel testklient (QR → prompt → svar).
- **http://localhost:8080/watch** — round-watch GUI-demo (Watch Ultimate 2-mockup):
  QR-parning på klockskärmen → samtycke → håll mic-knappen och tala (eller skriv)
  → streamat svar + uppläsning. Så här ser klock-UX:en ut innan vi bygger ArkTS-appen.

Flöde i båda: skanna QR med mobilen (eller öppna länken) → godkänn → klienten
plockar upp token, kopplar upp WSS och driver Claude Code.

## Demo-läge (för AppGallery-granskare / andra testare)

Kör med `DEMO_MODE=true` för en isolerad instans som en granskare kan testa utan
att röra ditt riktiga repo:

```bash
DEMO_MODE=true DEMO_BUDGET_USD=1 WORKSPACE_DIR=/tmp/ws-demo npm start
```

Ett seedat exempel-repo skapas i arbetsträdet, budget-tak och rate limiting
aktiveras. Se [`../docs/appgallery-compliance.md`](../docs/appgallery-compliance.md).

## Röst (fas 2)

Ljud spelas in på klienten och transkriberas i backend via valfri
OpenAI-kompatibel `/audio/transcriptions`-endpoint (Whisper, whisper.cpp, Groq …).
Sätt `STT_API_URL`, `STT_API_KEY` (och ev. `STT_MODEL`, `STT_LANGUAGE`). Utan dem
svarar servern `stt_unavailable` och klienten faller tillbaka på textinmatning.

## Miljövariabler

| Variabel | Default | Beskrivning |
|---|---|---|
| `PORT` | `8080` | Lyssningsport |
| `WORKSPACE_DIR` | `/tmp/workspace` | Legacy-arbetsträd (test-klienten) |
| `CHATS_DIR` | `/tmp/chats` | Neutral katalog för fristående Chats |
| `PROJECTS_DIR` | `/tmp/projects` | Projekt (varje underkatalog = ett projekt) |
| `CODE_DIR` | `/tmp/code` | Claude Code-repos (varje underkatalog = ett repo) |
| `CLAUDE_MODEL` | *(SDK-default)* | Ev. modellöverstyrning |
| `ANTHROPIC_API_KEY` | — | Läses av Agent SDK |
| `DEMO_MODE` | `false` | Isolerat sandbox-läge (seedat repo, caps) |
| `DEMO_BUDGET_USD` | `1.0` | Kostnadstak per session i demo-läge |
| `RATE_LIMIT_PER_MIN` | `12` | Max prompts per minut och session |
| `STT_API_URL` | — | OpenAI-kompatibel transcriptions-endpoint (fas 2) |
| `STT_API_KEY` | — | Nyckel för STT |
| `STT_MODEL` | `whisper-1` | STT-modell |
| `STT_LANGUAGE` | `sv` | Språk för transkribering |
| `HUAWEI_PUSH_APP_ID` | — | AGC App ID (Push Kit) |
| `HUAWEI_PUSH_CLIENT_ID` | — | OAuth client id (Push Kit) |
| `HUAWEI_PUSH_CLIENT_SECRET` | — | OAuth client secret (Push Kit) |
| `DETACHED_TTL_MS` | `600000` | Hur länge en frånkopplad session lever innan Claude rivs |

## WebSocket-protokoll

Klient → server:
```json
{ "type": "auth",    "token": "<device-flow token>" }
{ "type": "consent"  }
{ "type": "prompt",  "text": "gör X i repot" }
{ "type": "audio_start", "mime": "audio/webm" }
{ "type": "audio_chunk", "data": "<base64>" }
{ "type": "audio_end" }
{ "type": "report",  "text": "...", "reason": "user_report" }
{ "type": "register_push", "pushToken": "<Huawei Push Kit device token>" }
{ "type": "background" }
{ "type": "foreground" }
```
Server → klient: `authed` (`consented`, `demoMode`) · `needs_consent` · `consented` ·
`accepted` · `assistant` (`text`, ev. `filtered`) · `tool_use` · `needs_confirmation` ·
`transcribing` · `transcript` · `stt_unavailable` · `reported` · `result` (kostnad) ·
`turn_done` · `error`.

Navigation (tre ytor — Chats / Projects / Claude Code):
```json
{ "type": "list", "scope": "chats" | "projects" | "code" }
{ "type": "new_chat" }
{ "type": "open_chat",    "id": "<sessionId>" }
{ "type": "open_project", "id": "<projekt-id>" }
{ "type": "open_code",    "id": "<repo-namn>" }
```
Svar: `list_result` (`scope`, `items[{id,title,subtitle}]`) · `chat_opened`
(`context`, `kind`). **Chats** = fristående samtal i `CHATS_DIR` (Agent SDK
`listSessions`, återupptas via `resume`). **Projects** = kataloger under
`PROJECTS_DIR` med `project.json` (namn + instruktioner → `systemPrompt`).
**Claude Code** = git-repos under `CODE_DIR`, återupptas i sitt repo med full
verktygstillgång.

HTTP-compliance: `POST /report` (med token), `DELETE /account` (med token),
`GET /meta` (`{ demoMode, stt }`).

## Deploya till Google Cloud Run

```bash
gcloud run deploy huawei-claude-backend \
  --source backend \
  --region europe-north1 \
  --allow-unauthenticated \
  --set-env-vars ANTHROPIC_API_KEY=sk-...   # helst via Secret Manager
```

`Dockerfile` installerar `git` i imagen (Claude Codes Bash/Read/Edit behöver det)
och kör `node dist/server.js`. WebSocket och långa requests stöds av Cloud Run.

## Kända begränsningar (medvetna för prototypen)

- **State i minnet.** Device-koder och tokens ligger i `Map`. Funkar för en
  instans; för Cloud Run med autoskalning behövs delad lagring (Redis/Firestore)
  och `--min-instances 1` eller session affinity. Se spec §9.
- **Inloggningen är en stub.** `public/login.html` har en "Godkänn"-knapp, inte
  riktig OAuth. Anthropic-nyckeln bor redan bara i backend (aldrig på klienten) —
  men riktig användarinloggning ska in före skarp drift (spec §6).
- **Ingen röst än.** Det här är fas 1 (text). Fas 2 lägger till STT: klienten
  skickar ljud, backend transkriberar (svenska via t.ex. Whisper) → prompt.
- **Efemärt arbetsträd.** `WORKSPACE_DIR` försvinner när instansen återvinns;
  klona repo vid start eller montera en volym för persistens.
- **Verktygsgrinden är grov.** Regex-baserad blockering av `git push`/`rm -rf`
  m.m. → riktig bekräftelse-loop till mobilen kommer senare (spec §7).
