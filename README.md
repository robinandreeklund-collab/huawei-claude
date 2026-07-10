# Claude Code för Huawei Watch Ultimate 2

Projekt för att kunna **logga in på Claude Code och styra det med rösten** från en
Huawei Watch Ultimate 2 (HarmonyOS NEXT).

> **Kärninsikt:** Claude Code kan inte köra *på* klockan. Klockan blir en tunn
> röst-/textklient mot en backend där Claude Code faktiskt kör — samma mönster som
> "Claude Code on the web".

## Status

Utforskningsfas. Ingen kod ännu — detta repo innehåller den tekniska specen och
arkitekturbeslut inför en MVP.

## Dokument

- [`docs/teknisk-spec.md`](docs/teknisk-spec.md) — fullständig teknisk spec:
  arkitektur, komponenter, dataflöden, röst-pipeline, autentisering, risker och
  MVP-plan.

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
