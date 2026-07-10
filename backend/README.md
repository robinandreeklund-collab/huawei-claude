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
| Verktygsgrind (blockerar `git push` m.m.) | `src/claude-session.ts` | ✅ (prototypnivå, spec §7) |

## Kör lokalt

```bash
cd backend
npm install
npm run build && npm start      # eller: npm run dev
```

Autentisering mot Anthropic: Claude Agent SDK plockar upp `ANTHROPIC_API_KEY`
eller en `claude`-inloggning från miljön. Sätt `ANTHROPIC_API_KEY` innan start
om ingen finns.

Öppna sedan **http://localhost:8080/** :
1. Tryck "Starta inloggning" → en QR + kod visas.
2. Skanna med mobilen (eller öppna länken) → tryck "Godkänn klockan".
3. Testklienten plockar upp token, kopplar upp WSS och du kan skriva
   instruktioner till Claude Code och se svaret streamas.

## Miljövariabler

| Variabel | Default | Beskrivning |
|---|---|---|
| `PORT` | `8080` | Lyssningsport |
| `WORKSPACE_DIR` | `/tmp/workspace` | Arbetsträd där Claude Code kör (git/filer) |
| `CLAUDE_MODEL` | *(SDK-default)* | Ev. modellöverstyrning |
| `ANTHROPIC_API_KEY` | — | Läses av Agent SDK |

## WebSocket-protokoll

Klient → server:
```json
{ "type": "auth",   "token": "<device-flow token>" }
{ "type": "prompt", "text":  "gör X i repot" }
```
Server → klient: `authed` · `accepted` · `assistant` (text) · `tool_use` ·
`needs_confirmation` · `result` (kostnad) · `turn_done` · `error`.

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
