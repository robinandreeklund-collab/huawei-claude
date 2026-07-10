# Claude Code för Huawei Watch Ultimate 2

Projekt för att kunna **logga in på Claude Code och styra det med rösten** från en
Huawei Watch Ultimate 2 (HarmonyOS NEXT).

## Deploya & testa direkt

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/robinandreeklund-collab/huawei-claude)

Klicka på knappen → Render läser [`render.yaml`](render.yaml) och sätter upp
backenden (Docker, demo-läge). Du blir ombedd att ange din **`ANTHROPIC_API_KEY`**
under deployen. När den är uppe: öppna `https://<din-app>.onrender.com/watch` i
mobilen/webbläsaren och testa hela flödet (QR-inloggning → chattar/projekt/kod → röst/text).

> **Varför en API-nyckel och inte min Claude-inloggning?** Det finns två separata
> inloggningar: **QR-koden** loggar in klockan på *din backend* (det är din
> inloggning på klockan), medan **backenden ↔ Claude** kräver en API-nyckel.
> Anthropic tillåter [inte](https://code.claude.com/docs/en/agent-sdk/overview)
> claude.ai-/prenumerationsinloggning för appar byggda på Claude Agent SDK — API-nyckel
> är enda sanktionerade vägen. Nyckeln bor bara i backend; klockan ser den aldrig.
> Hämta en på [console.anthropic.com](https://platform.claude.com/). Kostnaden är per
> token (~$0.02–0.16 per svar), skild från din Claude Pro/Max.

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
QR-inloggning (device-flow), WebSocket-streaming, **röst/STT-pipeline** och en
**round-watch GUI-demo** i webbläsaren. Backend är härdad mot AppGallery-kraven
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
