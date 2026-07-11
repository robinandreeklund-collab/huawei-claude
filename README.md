# Claude Code för Huawei Watch Ultimate 2

Projekt för att kunna **logga in på Claude Code och styra det med rösten** från en
Huawei Watch Ultimate 2 (HarmonyOS NEXT).

## Deploya & testa direkt

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/robinandreeklund-collab/huawei-claude)

Klicka på knappen → Render läser [`render.yaml`](render.yaml) och sätter upp
backenden (Docker, demo-läge). **Inga hemligheter behövs vid deployen.** När den
är uppe: öppna `https://<din-app>.onrender.com/watch` i mobilen/webbläsaren och
testa hela flödet (QR-inloggning → chattar/projekt/kod → röst/text).

### Anslut din Claude-prenumeration (ingen extra kostnad)

Backenden kör på **din Claude Pro/Max**, inte betal-per-token-API. Efter deployen
öppnar du **`https://<din-app>.onrender.com/connect`** på telefonen och klistrar
in din token där — en gång. Skapa den på din egen dator:

```bash
npm i -g @anthropic-ai/claude-code      # om du inte redan har den
claude setup-token                      # logga in med ditt Claude-konto
```

Kopiera token (`sk-ant-oat01-…`, giltig ~1 år) och klistra in den på
`/connect`-sidan. Behandla den som ett lösenord. Klockan ser den aldrig — den
lagras bara i din backend, aldrig i appen eller i git.

> **De två inloggningarna:** QR-koden = *din inloggning på klockan* (klocka ↔ backend).
> Token på `/connect` = hur backenden kör *din* Claude Code på *din* prenumeration.
> Detta är tillåtet för personligt bruk (bara du). En API-nyckel (`sk-ant-api…`)
> fungerar också om du hellre betalar per token.
>
> Vill du hellre sätta den som miljövariabel? `CLAUDE_CODE_OAUTH_TOKEN` (eller
> `ANTHROPIC_API_KEY`) i Render-dashboarden fungerar lika bra. Sätt `ADMIN_SECRET`
> om du vill skydda `/connect`-sidan, och `CRED_FILE` på en persistent disk om du
> vill slippa klistra in igen efter en omdeploy.

> Hittar Render inte `render.yaml`? Den ligger på branchen
> `claude/huawei-watch-app-f0gwye`. Välj den branchen i Render (New ▸ Blueprint ▸
> välj repo och branch), eller merga branchen till din default-branch först.
> Gratisplanen somnar efter inaktivitet (kallstart ~30–60 s) — uppgradera till
> Starter om minnet tar slut.

> **Kärninsikt:** Claude Code kan inte köra *på* klockan. Klockan blir en tunn
> röst-/textklient mot en backend där Claude Code faktiskt kör — samma mönster som
> "Claude Code on the web".

## Status

Körbar relay-backend som driver Claude Code via Claude Agent SDK, med
QR-inloggning (device-flow), WebSocket-streaming (ord-för-ord), **röst/STT-pipeline**
och en **round-watch GUI-demo** i webbläsaren. Djup SDK-integration (se
[`docs/sdk-analys.md`](docs/sdk-analys.md)): modellförslag, modell per läge,
historik-replay, stopp/avbryt, plan-läge + bekräftelse-loop, progress-notiser,
kontextmätare, MCP, persistens och ångra. Backend är härdad mot AppGallery-kraven
(demo-läge, innehållsmoderering, samtycke, rapport, kontoradering). Testbar i
webbläsaren — ingen klocka behövs ännu. Nästa steg: fas 4 (ArkTS-klockappen)
när utvecklarkontot är verifierat.

Prova klock-UX:en: kör backend och öppna **`/watch`** (se `backend/README.md`).

## Dokument & kod

- [`docs/teknisk-spec.md`](docs/teknisk-spec.md) — fullständig teknisk spec:
  arkitektur, komponenter, dataflöden, röst-pipeline, autentisering, risker och
  MVP-plan.
- [`backend/`](backend/) — körbar relay-backend (device-flow-inloggning +
  Claude Code över WSS). Se [`backend/README.md`](backend/README.md) för att köra
  lokalt och deploya till Cloud Run.
- [`docs/appgallery-compliance.md`](docs/appgallery-compliance.md) — Huaweis
  granskningsregler, risker och de designbeslut vi binder oss vid för att appen
  ska kunna publiceras (moderering, demo-läge, integritet).

## Snabböversikt av arkitekturen

```
[Huawei Watch Ultimate 2]        [Din backend / relay]          [Anthropic]
  ArkTS-app                          Claude Code-session
  - mic → PCM-ljud   ── WSS ──►      (fjärrmiljö: git,     ── API ──►  Claude
  - visar svar       ◄── WSS ──      verktyg, filsystem)   ◄── API ──
  - TTS-uppläsning                   + STT (Whisper e.d.)

Inloggning: klockan visar en QR-kod → du skannar med mobilen → loggar in i
mobilens webbläsare → klockan får en kortlivad token. (OAuth device-flow,
RFC 8628 — ingen companion-app behövs, funkar med vilken telefon som helst.)
```

## Varför inte allt på klockan?

| Funktion | Var den kör | Varför |
|---|---|---|
| Claude Code-agenten | Backend | Kräver filsystem, git, node, verktyg |
| Röst → text (svenska) | Backend | HarmonyOS on-device STT stöder bara mandarin |
| Inloggning/OAuth | QR på klockan → mobilens webbläsare | Liten skärm; klockan får bara en kortlivad token |
| UI, mic, uppläsning | Klockan | Det klockan är bra på |
