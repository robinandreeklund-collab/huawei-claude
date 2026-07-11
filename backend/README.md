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
| **Klient = round-watch GUI** (enda klienten; QR → samtycke → röst/text → svar) | `public/watch.html` | ✅ verifierat |
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

Autentisering mot Anthropic sker via **Anslut Claude**-sidan (se nedan) — du
behöver alltså **ingen** miljövariabel för att starta. Alternativt plockar Agent
SDK upp `CLAUDE_CODE_OAUTH_TOKEN` eller `ANTHROPIC_API_KEY` från miljön om de är
satta.

En enda klient — **round-watch GUI:t** (Watch Ultimate 2-mockup). Det är
utgångspunkten: allt vi testar ser exakt ut som klockan kommer göra. Öppna
valfri av **http://localhost:8080/**, **/watch** eller **/test** — alla serverar
samma klock-GUI. QR-parning på klockskärmen → samtycke → håll mic-knappen och
tala (eller skriv) → streamat svar + uppläsning.

Flöde: skanna QR med mobilen (eller öppna länken) → godkänn → klienten plockar
upp token, kopplar upp WSS och driver Claude Code.

## Anslut Claude (klistra in din prenumerations-token en gång)

Istället för att redigera miljövariabler ansluter du Claude från en sida i
appen. Öppna **`/connect`** på din telefon (`https://<din-app>/connect`) och
klistra in din token — den lagras i backend och används av varje Claude
Code-session som startas.

```bash
# På din dator, en gång:
npm i -g @anthropic-ai/claude-code   # om du inte redan har den
claude setup-token                   # logga in med ditt Claude Pro/Max-konto
# → kopiera sk-ant-oat01-... och klistra in på /connect
```

`sk-ant-oat…` = din **prenumeration** (ingen extra API-kostnad, giltig ~1 år).
En `sk-ant-api…`-nyckel fungerar också (betalar per token). Backend väljer rätt
miljövariabel (`CLAUDE_CODE_OAUTH_TOKEN` resp. `ANTHROPIC_API_KEY`) automatiskt
när Claude Code startas.

- Sätt `ADMIN_SECRET` för att skydda sidan så bara du kan ansluta (sidan frågar
  då efter secreten).
- Token sparas i `CRED_FILE` (default `/tmp/claude-cred.json`). På en efemär värd
  (Cloud Run, Render free) försvinner `/tmp` vid omstart — peka `CRED_FILE` på en
  persistent disk för att slippa klistra in igen.
- Innan Claude anslutits svarar WSS `error: "Claude ej ansluten — öppna /connect
  på telefonen"` på prompts.

HTTP: `GET /connect` (sidan) · `GET /connect/status` (`{connected,source,kind}`) ·
`POST /connect` (`{token, secret?}`).

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
| `CLAUDE_MODEL` | *(SDK-default)* | Global modellöverstyrning (vinner över per-yta) |
| `CHAT_MODEL` | `claude-haiku-4-5` | Modell för Chats (snabb/glanceable) |
| `PROJECT_MODEL` / `CODE_MODEL` | *(default)* | Modell för Projekt / Claude Code |
| `CHAT_EFFORT` / `PROJECT_EFFORT` / `CODE_EFFORT` | — | Reasoning-effort per yta: `low`/`medium`/`high` |
| `FALLBACK_MODEL` | — | Modell(er) om primär är överbelastad (komma-sep.) |
| `MAX_TURNS` | `0` | Hård turgräns (0 = av) |
| `TASK_BUDGET_TOKENS` | `0` | API-token-budget så modellen pacar sig (0 = av) |
| `PROMPT_SUGGESTIONS` | `true` | Modellförslag som quick-replies |
| `AGENT_PROGRESS` | `true` | Progress-summeringar (statusrad + push-text) |
| `WATCH_GUIDANCE` | `true` | SessionStart-hook: korta, glanceable svar |
| `WATCH_TOOLS` | `true` | Ger Claude verktyg att agera på klockan (vibrera/notis/timer/hälsa/plats) |
| `SKILLS` | — | Aktivera SKILL.md-skills: `all` eller komma-lista |
| `DATA_DIR` | — | Persistent bas för historik/token (överlever omstart) |
| `DISALLOWED_TOOLS` | — | Verktyg att ta bort helt (komma-sep.) |
| `SANDBOX` | `false` | Isolerad kommandokörning (bubblewrap) |
| `CHECKPOINTING` | `true` | Fil-checkpoints → `Undo last change` |
| `MCP_CONFIG` | — | MCP-servrar som JSON (GitHub m.m.) |
| `CLAUDE_CODE_OAUTH_TOKEN` | — | Prenumerations-token (alternativ till `/connect`) |
| `ANTHROPIC_API_KEY` | — | API-nyckel (alternativ till `/connect`) |
| `CRED_FILE` | `…/claude-cred.json` | Var `/connect`-token lagras |
| `ADMIN_SECRET` | — | Skyddar `/connect` (tomt = öppet) |
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
{ "type": "stop" }                       // avbryt pågående tur (interrupt)
{ "type": "confirm", "id": "c1", "allow": true }   // svar på needs_confirmation
{ "type": "plan_mode", "on": true }      // planera utan att köra (read-only)
{ "type": "set_model", "model": "claude-sonnet-5" }
{ "type": "usage" }                      // begär kontext-användning
{ "type": "plan_usage" }                 // begär plan-rate-limits (5h/7d)
{ "type": "rewind" }                     // ångra senaste ändring (checkpointing)
{ "type": "models" }                     // hämta modell-lista (picker)
{ "type": "watch_reply", "id": "w1", "data": { } }  // svar på watch_query (sensor)
{ "type": "rename_session", "id": "…", "title": "Nytt namn" }
{ "type": "delete_session", "id": "…" }
{ "type": "branch_session", "id": "…" }  // grena en chatt (forkSession)
```
Server → klient: `authed` (`consented`, `demoMode`, `planMode`) · `needs_consent` ·
`consented` · `accepted` · `stream_start` / `stream_delta` (`text`) / `stream_end` /
`stream_filter` (live token-streaming, ord för ord) · `assistant` (`text`, `streamed`,
ev. `filtered`) · `tool_use` · `progress` (`text`; live summering) · `suggestion`
(`text`; modellens nästa-prompt) · `needs_confirmation` (`id`, `tool`, `command`) ·
`history` (`items[{role,text}]`; historik-replay) · `stopped` · `plan_mode` (`on`) ·
`model_set` · `usage_result` (`usage`) · `plan_usage_result` (`usage`) ·
`models_result` (`models`) · `rewind_result` (`ok`, `files`) · `watch_action`
(`action`: vibrate/notify/timer — Claude agerar på klockan) · `watch_query`
(`id`, `kind`: health/location — begär sensor-värde) · `session_renamed` /
`session_deleted` · `transcribing` · `transcript` · `stt_unavailable` · `reported` ·
`result` (kostnad) · `turn_done` · `error`.

Svaret streamas token-för-token (`includePartialMessages` i Agent SDK). Moderering
körs på den växande texten så ett flaggat stycke stoppas mitt i streamen
(`stream_filter`); den avslutande `assistant`-händelsen bär den slutgiltiga
modererade texten. I bakgrunden (frånkopplad) skickas inte stream-deltan — bara den
buffrade slutgiltiga texten + en push-notis.

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
`GET /meta` (`{ demoMode, stt, push, claude }`). Anslutning: `GET /connect`,
`GET /connect/status`, `POST /connect` (se **Anslut Claude** ovan).

## SDK-funktioner (nivå 1–3)

Byggt enligt [`../docs/sdk-analys.md`](../docs/sdk-analys.md):

- **Modellförslag** — `promptSuggestions` → riktiga nästa-prompt-chip.
- **Modell per yta** — Chats kör snabb Haiku, Code/Projekt ärver default
  (`CHAT_MODEL`/`CODE_MODEL`, `*_EFFORT`).
- **Robusthet** — `fallbackModel`, `maxBudgetUsd` (demo), `maxTurns`, `taskBudget`.
- **Historik-replay** — `getSessionMessages` renderar tidigare bubblor när man
  öppnar en session (inte tom matning).
- **Stopp** — `interrupt()` avbryter en pågående tur (Stopp-knapp).
- **Progress** — `agentProgressSummaries` → statusrad + bättre push-notistext.
- **Bekräftelse-loop** — `canUseTool` väntar på telefonens Allow/Deny (spec §7).
- **Plan-läge** — `permissionMode:'plan'`, togglas i åtgärdsmenyn.
- **Kontextmätare** — `getContextUsage()` i menyn.
- **CLAUDE.md** — `settingSources:['project']` i Code-läget.
- **MCP** — `MCP_CONFIG` → GitHub m.fl. som verktyg.
- **Persistens** — `DATA_DIR` (+ `CLAUDE_CONFIG_DIR`) överlever omstart.
- **Härdning** — `SANDBOX`, `DISALLOWED_TOOLS`.
- **Ångra** — `enableFileCheckpointing` + `rewindFiles()` (Undo last change).
- **Watch-hook** — SessionStart-hook håller svaren korta/glanceable.

### Nivå 4 — Claude agerar på klockan
- **Egna verktyg** (`createSdkMcpServer` + `tool()`) — in-process MCP-server `watch`
  ger Claude verktyg: `vibrate`, `notify`, `set_timer`, `read_health`, `get_location`.
  Action-verktyg pushar `watch_action` till klockan; sensor-verktyg gör en round-trip
  (`watch_query` → klockan svarar med `watch_reply`). På enheten mappar de till
  Sensor/Vibrator/Notification Kit (`../docs/ondevice-notifications.md`).
- **Robust återanslutning** — `reinitialize()` vid attach → väntande bekräftelser
  levereras om efter bakgrund/glapp.
- **Sessionshantering** — `renameSession`/`deleteSession`/`forkSession` via long-press
  på en chatt (Rename / Branch / Delete).
- **Modellväljare** — `supportedModels()` → picker i menyn (`set_model`).
- **Plan-gränser** — `usage_EXPERIMENTAL…()` → 5h/7d-fönster i kontextkortet.

## Deploya till Google Cloud Run

```bash
gcloud run deploy huawei-claude-backend \
  --source backend \
  --region europe-north1 \
  --allow-unauthenticated
# → öppna sedan https://<url>/connect och klistra in din token (se "Anslut Claude").
```

Ingen nyckel behövs vid deploy — anslut via `/connect` efteråt. `Dockerfile`
installerar `git` i imagen (Claude Codes Bash/Read/Edit behöver det) och kör
`node dist/server.js`. WebSocket och långa requests stöds av Cloud Run.

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
