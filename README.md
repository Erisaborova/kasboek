# Kasboek

Een kleine web-app (PWA) voor Erisa en Cas en hun gezamenlijke Revolut-rekening, in de stijl van een kassabon.
De app laat per persoon zien wat er deze maand moet worden overgemaakt en wat er onderling terugkomt, laat
voorschotten en declaraties invoeren en heeft betaalknoppen.

**De Google Sheet rekent; de app rekent niets uit.** Alle bedragen komen als tekst uit de Sheet.

## Wat zit waar

| Map | Wat |
| --- | --- |
| `docs/` | De app zelf (HTML, CSS, JS, service worker, iconen, lettertype, agendabestand). GitHub Pages serveert deze map. |
| `apps-script/` | `Code.gs` en `appsscript.json`: de backend, gebonden aan de Sheet. |
| `mockups/` | De klikbare ontwerpen en de stijlvergelijking. Staan in `.gitignore`, want ze bevatten bedragen. |

## Hoe het werkt

1. **Sheet = database.** Het Apps Script leest de cellen uit de bouwinstructie (sectie 4) en schrijft alleen in
   de invoerkolommen: Voorschotlog A:E, Declaraties A:H en Te doen F. Formules, opmaak en andere tabbladen
   blijven onaangeroerd. Rijen worden nooit verwijderd.
2. **Toegang.** Een geheime link (met daarin de web-app-URL en een lang token) plus een pincode van 4 cijfers.
   Het script controleert beide bij elk verzoek; na 8 foute pincodes gaat het 15 minuten op slot.
   Telefoons onthouden de link, de pincode en wie je bent; via Meer → "Vergeet dit apparaat" wis je dat.
3. **Geen dubbele rijen.** Elke toevoeging krijgt een eigen verzoek-ID en loopt onder een script-lock.
   Dubbel tikken of opnieuw versturen na een time-out levert dus nooit twee rijen op.
4. **Offline** zie je de laatst bekende stand. Opslaan wordt dan geweigerd met een melding, niet stil bewaard.
5. **Privacy.** `noindex`, geen analytics en geen externe verzoeken behalve naar het Apps Script.
   Het lettertype (IBM Plex Mono, OFL-licentie) staat in de app zelf.

De repo moet publiek zijn voor gratis GitHub Pages. Er staan geen bedragen, tokens, pincodes of Sheet-ID's in.
Wel de voornamen en de twee revolut.me-namen in `apps-script/Code.gs` (die zijn bedoeld om te delen).
`docs/demo.json` bevat echte bedragen en staat daarom in `.gitignore`.

## Instellen, stap voor stap

Doe dit eerst met de **testkopie** van de Sheet. Pas als alles werkt, herhaal je stap 2 en 3 in het echte bestand.

### 1. De app op GitHub Pages zetten

1. Maak op github.com een nieuwe **publieke** repository, bijvoorbeeld `kasboek`, zonder README.
2. Zet deze map erin. Het makkelijkst gaat dat met **GitHub Desktop**: File → Add local repository →
   kies `Documents/Kasboek` → "create a repository" → Commit → Publish repository. Haal daarbij het vinkje
   "Keep this code private" weg.
   Of in de Terminal:
   ```bash
   cd ~/Documents/Kasboek
   git init -b main && git add . && git commit -m "Kasboek"
   git remote add origin https://github.com/erisaborova/kasboek.git
   git push -u origin main
   ```
3. Op github.com: Settings → Pages → Build and deployment → Source: "Deploy from a branch",
   Branch: `main`, map `/docs` → Save. Na een minuut staat de app op
   `https://erisaborova.github.io/kasboek/`.

### 2. Het Apps Script koppelen

1. Open de Sheet → Extensies → Apps Script.
2. Vervang de inhoud van `Code.gs` door `apps-script/Code.gs`.
3. Projectinstellingen (tandwiel) → zet "Manifestbestand appsscript.json weergeven in editor" aan →
   vervang de inhoud van `appsscript.json` door `apps-script/appsscript.json`.
4. Kies in de editor de functie **instellen**, vul bovenin die functie tijdelijk jullie pincode in
   (`const PINCODE = '1234';`), en klik Uitvoeren. Geef toestemming als Google daarom vraagt.
   Zet de pincode daarna terug op `''` en sla op.
5. Implementeren → Nieuwe implementatie → type **Web-app** → Uitvoeren als: **Ik** → Wie heeft toegang:
   **Iedereen** → Implementeren. Kopieer de URL die eindigt op `/exec`.
6. Kies de functie **geheimeLinkTonen**, vul `APP_URL` (stap 1.3) en `WEBAPP_URL` (stap 2.5) in, voer uit.
   In het logboek staat nu de **geheime link**. Deel die alleen met Cas, samen met de pincode, liefst niet
   in hetzelfde bericht.

Pas je later `Code.gs` aan, kies dan Implementeren → Implementaties beheren → bewerken → Nieuwe versie.
Zo blijft de URL, en dus de geheime link, gelijk.

### 3. Tijdzone van de Sheet

De Sheet staat op de tijdzone `America/Los_Angeles`. Zet die op Johannesburg: Bestand → Instellingen →
Tijdzone → (GMT+02:00) Johannesburg. Het script slaat datums om 12:00 op, zodat de dag ook nu al klopt,
maar met de goede tijdzone is het zeker.

### 4. Herinneringen

Open `docs/Kasboek_herinneringen.ics` of tik in de app op Meer → "Zet in mijn agenda". Dat zijn vier
maandelijkse herinneringen: de 12e declareren, de 24e invullen, de 25e betalen, en vanaf de 25e wisselen.
Weekenden schuiven ze mee, feestdagen niet.

## Lokaal bekijken

```bash
python3 -m http.server 8766 --directory docs
```

Open daarna `http://localhost:8766/?demo`. Met `?demo` leest de app `docs/demo.json` in plaats van de Sheet
en slaat hij niets op.

## Maandelijks

De app hoeft niet mee te veranderen. De geplande Claude-taak vult rond de 26e de transacties aan en zet de
afrekenmaand (Voorschotlog I12) een stap verder. Zolang tabbladnamen en celadressen gelijk blijven, werkt
alles. Trek in de app omlaag om te verversen.

## Bekende open punten

- `revolut.me/...?amount=…&currency=EUR` vult het bedrag in als het **in centen** staat (45719 = € 457,19);
  getest op iPhone. De app toont het bedrag daarnaast met een kopieerknop.
- Een betaling naar de gezamenlijke rekening kan niet met een vast bedrag worden gestart; de knop opent alleen Revolut.
- Archiveren van afgeronde regels doet Claude, pas na bevestiging van Erisa. De app vinkt alleen af.
