# Claude Agent SDK — analys & förslag

Genomgång av `@anthropic-ai/claude-agent-sdk` (v0.3.x) mot vår watch-relay, för att
se vad vi kan lägga till och optimera. **Ingen kod här** — bara analys, värde och
prioritering. Källa: SDK:ns egna typdefinitioner (`sdk.d.ts`) + runtime-API:t (`Query`).

> **Status:** nivå 1–3 nedan är **implementerade** (se `backend/README.md` →
> "SDK-funktioner"). MCP, sandbox och persistent disk är inkopplade men avstängda
> tills man sätter respektive env-var/creds.

---

## 1. Vad vi redan använder

| Funktion | Var | Status |
|---|---|---|
| `query()` med streaming-input (multi-turn) | `claude-session.ts` | ✅ |
| `cwd`, `model`, `resume`, `systemPrompt` | per kontext (chat/projekt/kod) | ✅ |
| `env` (injicerar ansluten Claude-token) | `spawnEnv()` | ✅ |
| `includePartialMessages` (token-streaming) | ord-för-ord i chatten | ✅ (nyss) |
| `permissionMode: acceptEdits` | auto-godkänn filändringar | ✅ |
| `canUseTool` (regex-grind mot farliga kommandon) | `git push`, `rm -rf` … | ✅ (grov) |
| `listSessions()` | Chats/Code-listorna | ✅ |

Vi använder alltså kärnan — men bara en bråkdel av ytan. Nedan är det som ger mest
för just en **klocka** (låg latens, glanceable, bakgrund/haptik) och för **driften**
(Render/efemär disk, en användare idag men byggt för fler).

---

## 2. Snabba vinster (låg insats, högt värde)

### 2.1 Riktiga prompt-förslag — `promptSuggestions`
Idag är våra quick-replies hårdkodade ("Continue / Explain / Summarize"). SDK:t kan
generera **ett modellförutspått nästa-prompt** efter varje svar (`prompt_suggestion`-
händelse efter `result`). Det "piggybackar" på promptcachen → nästan gratis. → Byt ut
de statiska chipsen mot kontextuella förslag.

### 2.2 Modell per läge — `setModel()` + `effort` / `thinking`
En klocka vill kännas *snabb*. Vi kör samma modell överallt.
- **Chats** → snabb, billig modell (Haiku) med `effort: 'low'` → glanceable svar på sekunder.
- **Claude Code** → Sonnet/Opus med högre `effort` för riktig kodförståelse.
- `setModel()` kan bytas mitt i sessionen (streaming-läge, vilket vi kör).
→ Lägre latens där det märks, lägre kostnad, bättre kvalitet där det behövs.

### 2.3 Robusthet — `fallbackModel`, `maxBudgetUsd`, `taskBudget`
- `fallbackModel`: komma-separerad lista som testas om primärmodellen är överbelastad.
  Primärmodellen återförsöks varje tur → tillfälligt avbrott degraderar inte permanent.
- `maxBudgetUsd`: **native** budgettak (returnerar `error_max_budget_usd`). Vi gör idag
  en egen kostnadssummering — SDK:ts variant är hårdare och enklare.
- `taskBudget` (alpha): talar om för modellen hur mycket budget som är kvar så den
  **själv pacar** verktygsanvändning och avslutar innan taket. Bra i demo-läget.

### 2.4 Avbryt en tur — `Query.interrupt()` / `abortController`
Väldigt naturligt på en klocka: säg/tryck **"stopp"** och Claude slutar direkt
(barge-in). Idag kan man bara vänta ut en tur. `interrupt()` finns i streaming-läge och
ger till och med kvitto på vilka köade meddelanden som fortfarande kör.
→ En stopp-knapp i chatt-dockan + röstkommando.

### 2.5 Historik-replay — `getSessionMessages()`
**Fixar en känd lucka.** När man öppnar en gammal chatt/projekt/kod-session gör vi
`resume` — men matningen är tom tills man skriver något nytt. `getSessionMessages()`
läser den historiska konversationen så vi kan **rendera de tidigare bubblorna** direkt
när man går in i en session (och vid återanslutning efter bakgrund).

---

## 3. Klock-UX & interaktion

### 3.1 Live progress för långa turer — `agentProgressSummaries` + `task_progress`
När Claude jobbar länge (t.ex. i ett kodrepo) kan SDK:t var ~30:e sekund generera en
kort nulägesbeskrivning ("Analyzing authentication module"). Två användningar:
- Visa den som en **subtil statusrad** i chatten medan verktyg kör.
- Använd den som **push-notisens text** när man sänkt armen — mycket bättre än vår
  nuvarande "sista textbit". ("Claude · todo-api: Kör testerna…")

### 3.2 Kontext- & gräns-mätare — `getContextUsage()` + usage-API
- `getContextUsage()`: fördelning av kontextfönstret (system, verktyg, meddelanden,
  minne). → En liten "context fylld"-indikator, och auto-varning innan komprimering.
- Experimentellt usage-API: **claude.ai-planens rate-limit-fönster** (5h / 7d / per
  modell). → Klockan kan varna "närmar dig din gräns" innan du blir blockad.

### 3.3 Modell-/kommandoväljare — `supportedModels()`, `supportedCommands()`, `supportedAgents()`
Runtime-listor för att bygga en **inställningsvy på klockan**: välj modell, se
tillgängliga slash-kommandon och subagenter — allt hämtat dynamiskt från sessionen.

---

## 4. Historik, kontext & projektmedvetenhet

### 4.1 CLAUDE.md & projektinställningar — `settingSources: ['project']`
För **Claude Code**-läget: laddar repots `CLAUDE.md` och `.claude/`-inställningar så
Claude förstår projektets konventioner. Idag isolerar vi bort det. → Skarpare svar i
riktiga repon.

### 4.2 Fler kataloger / stora repon — `additionalDirectories`, `betas: context-1m`
- `additionalDirectories`: ge Claude tillgång till fler repos/paths i samma session
  (t.ex. backend + frontend).
- 1M-kontext (Sonnet, beta): stora kodbaser utan att tappa tråden.

### 4.3 Billigare för flera användare — `excludeDynamicSections`
Om appen någon gång servar >1 person: strippar per-användar-dynamik ur systemprompten
så cache-prefixet **träffar korsanvändare** → lägre kostnad i en flotta.

---

## 5. Säkerhet, behörighet & compliance (AppGallery)

### 5.1 Riktig bekräftelse-loop till telefonen — `permissionPromptToolName` / MCP-permission
Idag *nekar* `canUseTool` bara farliga kommandon (spec §7 vill ha en riktig "bekräfta
på telefonen"). SDK:t kan **routa behörighetsfrågor genom ett MCP-verktyg** → vi kan
skicka frågan till mobilen och släppa igenom vid explicit ja.

### 5.2 Plan-läge — `permissionMode: 'plan'` (+ `planModeInstructions`)
Read-only läge där Claude **planerar utan att köra** och visar planen först. Perfekt
för en klocka: "så här tänker jag göra" → du godkänner → körs. Säkrare och glanceable.

### 5.3 Sandlåda — `sandbox` (bubblewrap)
Kör kommandon isolerat (filsystem/nätverk begränsat via permission-regler). Härdning
för **demo-/granskningsinstansen** — en granskare kan aldrig röra något känsligt.

### 5.4 Hårda verktygsgränser — `disallowedTools`, `hooks`
- `disallowedTools`: ta bort verktyg helt ur modellens kontext (t.ex. `WebFetch`) i
  stället för regex-gissning.
- `hooks` (PreToolUse/PostToolUse/SessionStart …): strukturerade grindar + loggning +
  moderering på **verktygsnivå**, inte bara på text. Renare än vår nuvarande regex.

---

## 6. Ny kapacitet (funktioner vi kan öppna upp)

### 6.1 MCP-servrar — `mcpServers`
Störst hävstång. Koppla in verktyg: **GitHub** (skapa PR, kolla CI), Jira, Linear,
databaser … Vi använder redan GitHub-MCP i utvecklingen — samma sak kan exponeras för
klockan: *"Claude, öppna en PR på det här"* från handleden.

### 6.2 Egna subagenter — `agents`
Definiera specialiserade subagenter (t.ex. *reviewer*, *researcher*, *test-runner*)
som Claude kan delegera till. Med `forwardSubagentText` kan vi visa en nästlad
transkript-vy.

### 6.3 Ångra ändringar — `enableFileCheckpointing` + `Query.rewindFiles()`
Checkpointar filer före ändring; `rewindFiles()` återställer till valfritt
användarmeddelande. → En **"ångra senaste ändring"**-knapp på klockan. Bra säkerhetsnät
när man styr kod med rösten.

### 6.4 Strukturerade svar — `outputFormat: json_schema`
Tvinga svar till ett schema → **glanceable kort** i stället för prosa (t.ex. ett
status-kort med fält: fil, rad, åtgärd) — passar en liten rund skärm mycket bra.

---

## 7. Drift & persistens (Render/efemärt)

### 7.1 Överlev container-återvinning — `sessionStore`
Idag ligger sessioner i `/tmp` som **töms när Render-instansen återvinns** (och på
free-planen somnar den). `sessionStore` speglar transkript till en **extern lagring**
(dual-write) → chattar/projekt/kod-historik överlever omstart och redeploy. Detta är
den enskilt viktigaste drift-förbättringen för en "riktig" instans.

### 7.2 Efemära körningar — `persistSession: false`
Motsatsen, för engångsjobb där historik inte behövs (t.ex. demo-turer) → mindre disk.

---

## 8. Prioriterad rekommendation

**Nivå 1 — gör snart (liten insats, tydligt lyft):**
1. `promptSuggestions` i stället för hårdkodade chips.
2. Modell per läge (`setModel` + `effort`): Haiku/low för Chats, Sonnet/high för Code.
3. `fallbackModel` + `maxBudgetUsd`/`taskBudget` i query-optionerna.
4. `getSessionMessages()` → rendera historik när man öppnar en session (stänger luckan).
5. `interrupt()` → stopp-knapp/röst-"stopp".

**Nivå 2 — nästa våg (medel insats, stort värde):**
6. `agentProgressSummaries` → riktiga push-/status-texter för långa turer.
7. `mcpServers` (GitHub först) → agera på repon från klockan.
8. Plan-läge + riktig bekräftelse-loop till telefonen (`permissionMode: 'plan'` /
   `permissionPromptToolName`).
9. `getContextUsage()` + usage-API → kontext-/gränsmätare på klockan.
10. `settingSources: ['project']` → CLAUDE.md-medvetenhet i Code-läget.

**Nivå 3 — strategiskt (större, för "riktig" drift):**
11. `sessionStore` → historik överlever Render-omstart.
12. `sandbox` + `disallowedTools`/`hooks` → härdning för AppGallery-granskning.
13. `enableFileCheckpointing` + `rewindFiles()` → ångra-funktion.
14. Egna `agents`, `outputFormat`-kort, 1M-kontext, cachebar systemprompt för flotta.

---

## 9. Optimeringar av befintlig kod (utan ny funktion)
- Ersätt vår manuella budgetsummering med `maxBudgetUsd` (låt SDK:t äga taket).
- Ersätt regex-verktygsgrinden med `disallowedTools` + `hooks` (färre falska träffar).
- Sätt `fallbackModel` för färre "overloaded"-fel utan att vi själva retryar.
- Låt push-notisen använda `agentProgressSummaries` i stället för sista textbiten.
- `maxTurns` som skyddsnät mot skenande loopar.
