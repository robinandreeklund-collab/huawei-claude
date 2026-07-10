# Claude Code för Huawei Watch Ultimate 2

Projekt för att kunna **logga in på Claude Code och styra det med rösten** från en
Huawei Watch Ultimate 2 (HarmonyOS NEXT).

> **Kärninsikt:** Claude Code kan inte köra *på* klockan. Klockan blir en tunn
> röst-/textklient mot en backend där Claude Code faktiskt kör — samma mönster som
> "Claude Code on the web".

## Status

MVP fas 1 + 3 körbar: en relay-backend som driver Claude Code via Claude Agent
SDK, med QR-inloggning (device-flow) och WebSocket-streaming. Testbar i
webbläsaren — ingen klocka behövs ännu. Nästa steg: fas 2 (röst/STT) och fas 4
(ArkTS-klockappen).

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
