# AppGallery-compliance — regler, risker och designbeslut

Status: aktiv checklista. Mål (valt): **bygg så appen KAN publiceras** — använd själv
via sideload nu, men håll arkitekturen AppGallery-ren så vägen till publicering är
öppen utan omtag.

> Sammanfattning: inget i Huaweis regelverk är en dödsstöt för den här appen. Men två
> punkter — **AI-innehållsmoderering** och **ett testbart demo-läge för granskaren** —
> måste designas in från början i backend, inte byggas om senare.

---

## 1. Två distributionsvägar

| Väg | Kräver granskning? | När |
|---|---|---|
| **Sideload** (developer mode på egen klocka) | ❌ Nej | Personligt bruk, all utveckling/test |
| **AppGallery** (publik distribution) | ✅ Ja, full review | När appen ska ut till andra |

Vi utvecklar och kör på egen klocka via sideload hela vägen. Reglerna nedan gäller
först när/om vi publicerar — men vi respekterar dem i designen från start.

---

## 2. Risker rangordnade (det som kan stoppa appen i granskning)

### 🔴 R1 — AI-/användargenererat innehåll måste modereras
Huawei kräver för appar med användar-/AI-genererat innehåll: "filter mechanisms …
reporting mechanisms … disabling services for users who severely violate guidelines".
En LLM som producerar fri text och tar fri input är precis vad regeln siktar på.

**Designbeslut:**
- **D1.1** Serverside-filterlager mellan användarens prompt/Claudes svar och klienten
  (blockera/maskera uppenbart otillåtet innehåll). Anthropics inbyggda safety räcker
  inte som *enda* försvar i granskarens ögon.
- **D1.2** Rapporteringsväg i appen ("rapportera olämpligt svar") som loggar till backend.
- **D1.3** Möjlighet att stänga av en användare som grovt missbrukar tjänsten.
- **D1.4** Framing i store-listningen: personligt utvecklarverktyg för *din egen*
  autentiserade miljö — inte en social plattform där användare publicerar till varandra.

### 🔴 R2 — Granskaren måste kunna logga in och köra appen
Huawei kräver giltigt testkonto + inloggning + alla resurser som behövs för review.
Vår app kräver QR-inloggning **och** en backend som driver Claude Code (kostar pengar,
kräver API-nyckel, exponerar en riktig agent).

**Designbeslut:**
- **D2.1** **Demo-/sandbox-läge**: ett testkonto vars QR-inloggning fungerar men pekar
  på en isolerad backend/arbetsträd — aldrig ditt riktiga repo eller din personliga nyckel.
- **D2.2** Demo-backend med rate limiting och en budgettak-nyckel (skyddar mot att
  granskningen drar iväg i kostnad).
- **D2.3** Demo-arbetsträdet innehåller ett ofarligt exempelrepo så agenten har något
  att arbeta med utan att kunna göra skada.

### 🟠 R3 — "Kör kommandon / styr agent" kan väcka säkerhetsmisstanke
Appar får inte "improperly use any network or device … or pose security risks".

**Designbeslut:**
- **D3.1** **Inget körs på klockan.** Klockan är en tunn klient mot din egen
  autentiserade miljö (jämför SSH-/terminalklienter som finns i butiker). Detta ska
  stå tydligt i beskrivning och privacy policy.
- **D3.2** Klienten begär inga känsliga enhetsbehörigheter utöver mikrofon (fas 2)
  och nätverk.

### 🟠 R4 — Integritet & gränsöverskridande dataöverföring
Privacy policy måste ange all tredjepart samt syfte/metod/omfång för datainsamling;
cross-border kräver samtycke. Prompts (och senare röstljud) går EU → vår backend →
Anthropic (US). GDPR + Huaweis regler gäller.

**Designbeslut:**
- **D4.1** Privacy policy som listar: vad som samlas (prompts, ev. ljud), vart det går
  (vår backend, Anthropic i USA), syfte, lagringstid, och användarens rättigheter.
- **D4.2** Samtyckessteg vid första inloggning innan något skickas.
- **D4.3** Kontoborttagning / "radera mina data"-väg (vanligt krav).
- **D4.4** Ljud (fas 2) behandlas transient — spara inte råljud längre än transkribering kräver.

### 🟡 R5 — Mikrofon (fas 2) förlänger och skärper granskning
Mic-behörighet ger längre review (≈3–5 dagar) och kräver att appen hanterar att
användaren *nekar* behörighet.

**Designbeslut:**
- **D5.1** Deklarera endast behörigheter vi faktiskt använder; ta bort resten.
- **D5.2** Push-to-talk med runtime-begäran (`requestPermissionsFromUser`) + graciöst
  fallback till textinmatning om mic nekas.
- **D5.3** Testa nekad behörighet, inte bara godkänd.

---

## 3. Inte hinder (bekräftat)

- **Ingen ICP-filing** — det kravet gäller bara servrar i Fastlandskina. Release utanför
  Kina från Sverige berörs inte.
- **Individuellt utvecklarkonto** duger för release utanför Kina (enterprise krävs inte).
- **Native watch-appar är tillåtna** — Watch Ultimate 2 (HarmonyOS NEXT) är rätt plattform.

---

## 4. Konsekvens för backend-arkitekturen (redan nu)

Bygg in i relay-backenden medan vi ändå utvecklar:

- [ ] **Demo-läge** styrt av env/flagga: isolerat arbetsträd + budgettak-nyckel + rate limiting (R2).
- [ ] **Filter-hook** i svarsströmmen där ett moderationssteg kan sitta (R1).
- [ ] **Rapport-endpoint** (`POST /report`) som loggar ett flaggat svar (R1).
- [ ] **Samtyckes-flagga** på sessions-token: inget prompt-flöde innan samtycke (R4).
- [ ] **Kontoradering**-endpoint (R4).

Dessa är billiga att lägga in nu och dyra att retrofitta senare.

---

## 5. Att verifiera innan en faktisk inlämning

- [ ] Läs igenom aktuella [AppGallery Review Guidelines](https://developer.huawei.com/consumer/en/doc/50140)
  i sin helhet (regelverket uppdateras; senast sett 2025-05).
- [ ] Bekräfta wearable-specifik validering (round-screen UI, standalone vs companion,
  behörighetstester) — se [wearable-valideringsguiden](https://developer.huawei.com/consumer/en/multidevice/wearables/get-started/).
- [ ] Färdig privacy policy publicerad på en nåbar URL.
- [ ] Demo-testkonto + instruktioner klara att lämna till granskaren.

---

## Källor

- [AppGallery Review Guidelines (översikt)](https://developer.huawei.com/consumer/en/doc/50140)
- [4. App Content](https://developer.huawei.com/consumer/en/doc/app/50104-04) — innehålls- och modereringsregler
- [7. User Privacy](https://developer.huawei.com/consumer/en/doc/app/50104-07)
- [FAQs om ICP-filing](https://developer.huawei.com/consumer/en/doc/app/50111-03)
- [Behörigheter på HarmonyOS wearables](https://forums.developer.huawei.com/forumPortal/en/topic/0201201794904061122)
- [Wearable app-utveckling — kom igång](https://developer.huawei.com/consumer/en/multidevice/wearables/get-started/)
